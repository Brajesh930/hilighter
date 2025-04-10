document.addEventListener("DOMContentLoaded", () => {
  const rulesContainer = document.getElementById("rulesContainer");
  const addBoxBtn = document.getElementById("addBox");
  const highlightBtn = document.getElementById("highlightBtn");

  const defaultColors = ["#ffeb3b", "#a5d6a7", "#90caf9", "#f48fb1", "#ffe082", "#b39ddb", "#80cbc4"];

  const createRuleBox = (value = "", color = "#ffeb3b") => {
    const div = document.createElement("div");
    div.className = "rule-box";

    const textarea = document.createElement("textarea");
    textarea.placeholder = "e.g. ((monitoring or event) 5D (sensor or data)) or (monitor+ or event)";
    textarea.value = value;

    const colorPicker = document.createElement("input");
    colorPicker.type = "color";
    colorPicker.className = "color-picker";
    colorPicker.value = color;

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "x";
    removeBtn.onclick = async () => {
      // Remove highlights for this rule
      const rule = textarea.value.trim();
      const tag = encodeURIComponent(rule);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [tag],
        func: (tag) => {
          document.querySelectorAll(`span[data-highlight="${tag}"]`).forEach(el => {
            const text = document.createTextNode(el.textContent);
            el.replaceWith(text);
          });
        }
      });
      div.remove();
    };

    div.appendChild(textarea);
    div.appendChild(removeBtn);
    div.appendChild(colorPicker);
    rulesContainer.appendChild(div);
  };

  chrome.storage.sync.get(["savedRules"], (result) => {
    const saved = result.savedRules || [];
    if (saved.length === 0) createRuleBox(); // Default one
    else saved.forEach(({ rule, color }) => createRuleBox(rule, color));
  });

  addBoxBtn.addEventListener("click", () => {
    createRuleBox("", defaultColors[Math.floor(Math.random() * defaultColors.length)]);
  });

  highlightBtn.addEventListener("click", async () => {
    const boxes = Array.from(rulesContainer.querySelectorAll(".rule-box"));
    const ruleData = [];

    boxes.forEach(box => {
      const rule = box.querySelector("textarea").value.trim();
      const color = box.querySelector("input[type='color']").value;
      if (rule) ruleData.push({ rule, color });
    });

    chrome.storage.sync.set({ savedRules: ruleData });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    for (const { rule, color } of ruleData) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [rule, color],
        func: (inputStr, color) => {
          const escapeRegex = (str) =>
            str.replace(/([.*+?^${}()|\[\]\\])/g, "\\$1")
              .replace(/\\\?/g, ".")
              .replace(/\\\+/g, ".+")
              .replace(/\\\*/g, ".*");

          const parseInput = (input) => {
            const proximityMatch = input.match(/\(\((.*?)\)\s+(\d+)D\s+\((.*?)\)\)/i);
            if (proximityMatch) {
              const group1 = proximityMatch[1].split(/\s+or\s+/i).map(w => new RegExp(`^${escapeRegex(w.trim())}$`, 'i'));
              const group2 = proximityMatch[3].split(/\s+or\s+/i).map(w => new RegExp(`^${escapeRegex(w.trim())}$`, 'i'));
              const distance = parseInt(proximityMatch[2]);
              return { type: "proximity", group1, group2, distance };
            }

            const groupMatch = input.match(/^\((.*?)\)$/);
            if (groupMatch) {
              const group = groupMatch[1].split(/\s+or\s+/i).map(w => new RegExp(`^${escapeRegex(w.trim())}$`, 'i'));
              return { type: "single", group };
            }

            return null;
          };

          const config = parseInput(inputStr);
          if (!config) return;

          const tag = encodeURIComponent(inputStr);

          const highlightWord = (node, startIndex, endIndex) => {
            const range = document.createRange();
            range.setStart(node, startIndex);
            range.setEnd(node, endIndex);
            const span = document.createElement("span");
            span.style.backgroundColor = color;
            span.style.color = "black";
            span.style.borderRadius = "3px";
            span.setAttribute("data-highlight", tag);
            span.appendChild(range.extractContents());
            range.insertNode(span);
          };

          const matchesGroup = (word, group) => group.some(regex => regex.test(word));

          const getAllTextNodes = (root) => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
              acceptNode: (node) => {
                if (
                  node.parentNode &&
                  !/(script|style|noscript|iframe|head|title)/i.test(node.parentNode.tagName)
                ) return NodeFilter.FILTER_ACCEPT;
                return NodeFilter.FILTER_REJECT;
              }
            });
            const nodes = [];
            let current;
            while (current = walker.nextNode()) {
              nodes.push(current);
            }
            return nodes;
          };

          const nodes = getAllTextNodes(document.body);

          for (const node of nodes) {
            const text = node.nodeValue;
            const words = text.split(/\s+/);
            const cleaned = words.map(w => w.toLowerCase().replace(/[^\w]/g, ""));
            const offsets = [];

            let cursor = 0;
            for (let word of words) {
              offsets.push({ word, start: cursor });
              cursor += word.length + 1;
            }

            let matchedIndexes = [];

            if (config.type === "proximity") {
              for (let i = 0; i < cleaned.length; i++) {
                const w1 = cleaned[i];
                const isA = matchesGroup(w1, config.group1);
                const isB = matchesGroup(w1, config.group2);

                if (isA) {
                  for (let j = i + 1; j <= i + config.distance + 1 && j < cleaned.length; j++) {
                    if (matchesGroup(cleaned[j], config.group2)) {
                      matchedIndexes.push(i, j);
                    }
                  }
                } else if (isB) {
                  for (let j = i + 1; j <= i + config.distance + 1 && j < cleaned.length; j++) {
                    if (matchesGroup(cleaned[j], config.group1)) {
                      matchedIndexes.push(i, j);
                    }
                  }
                }
              }
            } else if (config.type === "single") {
              for (let i = 0; i < cleaned.length; i++) {
                if (matchesGroup(cleaned[i], config.group)) {
                  matchedIndexes.push(i);
                }
              }
            }

            if (matchedIndexes.length > 0) {
              [...new Set(matchedIndexes.flat())]
                .sort((a, b) => b - a)
                .forEach(i => {
                  const start = offsets[i].start;
                  const end = start + offsets[i].word.length;
                  highlightWord(node, start, end);
                });
            }
          }
        }
      });
    }
  });
});