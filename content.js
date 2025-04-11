chrome.storage.sync.get(["savedRules", "autoHighlightEnabled"], ({ savedRules, autoHighlightEnabled }) => {
    if (autoHighlightEnabled && savedRules) {
      highlightPage(savedRules);
    }
  });
  
  function highlightPage(rules) {
    const escapeRegex = (str) =>
      str.replace(/([.*+?^${}()|\[\]\\])/g, "\\$1")
        .replace(/\\\?/g, ".?")
        .replace(/\\\+/g, ".+")
        .replace(/\\\*/g, ".*");
  
    const parseInput = (input) => {
      const tripleProximityRegex = /^\(\(\((.+?)\)\s+(\d+)D\s+\((.+?)\)\)\s+(\d+)D\s+\((.+?)\)\)$/i;
      const doubleProximityRegex = /^\(\((.+?)\)\s+(\d+)D\s+\((.+?)\)\)$/i;
      const singleGroupRegex = /^\((.+?)\)$/i;
  
      let match;
  
      if (match = input.match(tripleProximityRegex)) {
        return {
          type: "triple-proximity",
          group1: match[1].split(/\s+or\s+/i).map(w => new RegExp(`^${escapeRegex(w.trim())}$`, 'i')),
          distance1: parseInt(match[2]),
          group2: match[3].split(/\s+or\s+/i).map(w => new RegExp(`^${escapeRegex(w.trim())}$`, 'i')),
          distance2: parseInt(match[4]),
          group3: match[5].split(/\s+or\s+/i).map(w => new RegExp(`^${escapeRegex(w.trim())}$`, 'i'))
        };
      }
  
      if (match = input.match(doubleProximityRegex)) {
        return {
          type: "proximity",
          group1: match[1].split(/\s+or\s+/i).map(w => new RegExp(`^${escapeRegex(w.trim())}$`, 'i')),
          distance: parseInt(match[2]),
          group2: match[3].split(/\s+or\s+/i).map(w => new RegExp(`^${escapeRegex(w.trim())}$`, 'i'))
        };
      }
  
      if (match = input.match(singleGroupRegex)) {
        return {
          type: "single",
          group: match[1].split(/\s+or\s+/i).map(w => new RegExp(`^${escapeRegex(w.trim())}$`, 'i'))
        };
      }
  
      return null;
    };
  
    const matchesGroup = (word, group) => group.some(regex => regex.test(word));
  
    const highlightWord = (node, startIndex, endIndex, color, tag) => {
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
  
    const getAllTextNodes = (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (node.parentNode && !/(script|style|noscript|iframe|head|title)/i.test(node.parentNode.tagName))
            return NodeFilter.FILTER_ACCEPT;
          return NodeFilter.FILTER_REJECT;
        }
      });
      const nodes = [];
      let current;
      while (current = walker.nextNode()) nodes.push(current);
      return nodes;
    };
  
    const nodes = getAllTextNodes(document.body);
  
    rules.forEach(({ rule, color }) => {
      const config = parseInput(rule);
      if (!config) return;
  
      const tag = encodeURIComponent(rule);
  
      nodes.forEach(node => {
        const text = node.nodeValue;
        const words = text.split(/\s+/);
        const cleaned = words.map(w => w.toLowerCase().replace(/[^\w]/g, ""));
        const offsets = [];
        let cursor = 0;
        words.forEach(word => {
          offsets.push({ word, start: cursor });
          cursor += word.length + 1;
        });
  
        let matchedIndexes = new Set();
  
        if (config.type === "single") {
          cleaned.forEach((w, i) => {
            if (matchesGroup(w, config.group)) matchedIndexes.add(i);
          });
        }
  
        if (config.type === "proximity") {
          cleaned.forEach((w, i) => {
            if (matchesGroup(w, config.group1)) {
              for (let j = i + 1; j <= i + config.distance + 1 && j < cleaned.length; j++) {
                if (matchesGroup(cleaned[j], config.group2)) {
                  matchedIndexes.add(i).add(j);
                }
              }
            }
          });
        }
  
        if (config.type === "triple-proximity") {
          cleaned.forEach((w, i) => {
            if (matchesGroup(w, config.group1)) {
              for (let j = i + 1; j <= i + config.distance1 + 1 && j < cleaned.length; j++) {
                if (matchesGroup(cleaned[j], config.group2)) {
                  for (let k = j + 1; k <= j + config.distance2 + 1 && k < cleaned.length; k++) {
                    if (matchesGroup(cleaned[k], config.group3)) {
                      matchedIndexes.add(i).add(j).add(k);
                    }
                  }
                }
              }
            }
          });
        }
  
        [...matchedIndexes].sort((a, b) => b - a).forEach(i => {
          const start = offsets[i].start;
          const end = start + offsets[i].word.length;
          highlightWord(node, start, end, color, tag);
        });
      });
    });
  }