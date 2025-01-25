import {
  initOptions,
  isSelectionValid,
  isWindowLocationValid,
  areKeysPressed,
  occurrenceRegex,
  isAncestorNodeValid,
  trimRegex,
  highlightName,
  areScrollMarkersEnabled,
} from "../options/options";
import {
  isSelectionWithAnchorAndFocusNodes,
  SelectionWithAnchorAndFocusNodes,
} from "./types";
import {
  addPressedKeysListeners,
  addStyleElement,
  addScrollMarkersCanvas,
} from "./utils";

declare global {
  interface Highlight {
    ranges(): IterableIterator<Range>;
  }
}

let pressedKeys: string[] = [];
let scrollMarkersCanvasContext: CanvasRenderingContext2D;
let isNewSelection = false;
let lastSelectionString: string;
let latestRunNumber = 0;

// 记录已高亮的文本和颜色
let highlightsMap: Map<string, string> = new Map();
const colorPalette = ['#FFEB3B', '#FF4081', '#4CAF50', '#2196F3', '#9C27B0', '#FFC107']; // 高亮颜色池
let colorIndex = 0;
let usedColors: Set<string> = new Set(); // 跟踪已使用的颜色

let highlightInstances: Map<string, { highlight: Highlight; index: number }> = new Map();
let highlightCounter = 0;
let updateStyles: () => void;

let isSelecting = false;

function addHighlightStyles() {
  const styleSheet = document.createElement('style');
  document.head.appendChild(styleSheet);

  // 监听highlightsMap的变化，更新样式
  updateStyles = () => {
    let styles = '';
    highlightsMap.forEach((color, text) => {
      const highlightData = highlightInstances.get(text);
      if (highlightData) {
        styles += `
          ::highlight(${highlightName()}_${highlightData.index}) {
            background-color: ${color};
          }
        `;
      }
    });
    styleSheet.textContent = styles;
  };

  // 初始调用一次
  updateStyles();
}

(async function () {
  await initOptions();
  await addStyleElement();
  const updateStyles = addHighlightStyles();
  scrollMarkersCanvasContext = await addScrollMarkersCanvas();
  pressedKeys = addPressedKeysListeners();
  
  // 监听鼠标按下事件，开始选择
  document.addEventListener("mousedown", () => {
    isSelecting = true;
  });
  
  // 监听鼠标松开事件，结束选择并处理高亮
  document.addEventListener("mouseup", () => {
    if (isSelecting) {
      isSelecting = false;
      onSelectionChange();
    }
  });
  
  document.addEventListener("selectstart", onSelectStart);
  // 移除 selectionchange 事件监听器，改为在 mouseup 时处理
  // document.addEventListener("selectionchange", onSelectionChange);
})();

function onSelectStart() {
  isNewSelection = true;
}

function onSelectionChange() {
  const selectionString = window.getSelection() + "";
  if (!isNewSelection && selectionString === lastSelectionString) return;

  isNewSelection = false;
  lastSelectionString = selectionString;
  const runNumber = ++latestRunNumber;

  if (!isWindowLocationValid(window.location)) return;
  if (!areKeysPressed(pressedKeys)) return;
  highlight(runNumber);

  if (!areScrollMarkersEnabled()) return;
  // drawScrollMarkers(runNumber);
}

function getNextAvailableColor(): string {
  // 如果所有颜色都已使用，直接使用下一个索引的颜色
  if (usedColors.size >= colorPalette.length) {
    colorIndex = (colorIndex + 1) % colorPalette.length;
    return colorPalette[colorIndex];
  }
  
  // 找到第一个未使用的颜色
  const availableColor = colorPalette.find(color => !usedColors.has(color)) || colorPalette[0];
  usedColors.add(availableColor);
  colorIndex = colorPalette.indexOf(availableColor);
  return availableColor;
}

function highlight(runNumber: number) {
  const selection = document.getSelection();
  if (!isSelectionWithAnchorAndFocusNodes(selection)) return;

  const trimmedSelection = String(selection).match(trimRegex());
  if (!trimmedSelection) return;

  const leadingSpaces = trimmedSelection[1];
  const selectionString = trimmedSelection[2];
  const trailingSpaces = trimmedSelection[3];
  if (!isSelectionValid(selectionString, selection)) return;

  // 检查文本是否已经被高亮
  if (highlightInstances.has(selectionString)) {
    // 如果已高亮，则移除高亮
    const highlightData = highlightInstances.get(selectionString);
    if (highlightData) {
      const oldColor = highlightsMap.get(selectionString);
      if (oldColor) {
        usedColors.delete(oldColor); // 释放这个颜色，使其可以被重新使用
      }
      const index = highlightData.index;
      CSS.highlights.delete(`${highlightName()}_${index}`);
      highlightInstances.delete(selectionString);
      highlightsMap.delete(selectionString);
      updateStyles();
    }
    return;
  }

  // 为新文本创建高亮
  const newHighlight = new Highlight();
  highlightCounter++; // 增加计数器
  highlightInstances.set(selectionString, { 
    highlight: newHighlight, 
    index: highlightCounter 
  });
  CSS.highlights.set(`${highlightName()}_${highlightCounter}`, newHighlight);

  // 为新文本分配颜色
  const highlightColor = getNextAvailableColor();
  highlightsMap.set(selectionString, highlightColor);
  updateStyles();

  const regex = occurrenceRegex(
    selectionString.replace(/[/\-\\^$*+?.()|[\]{}]/g, "\\$&")
  );

  const treeWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null
  );

  let match;
  while (treeWalker.nextNode() && runNumber === latestRunNumber) {
    if (!(treeWalker.currentNode instanceof Text)) continue;
    while ((match = regex.exec(treeWalker.currentNode.data))) {
      highlightOccurrences(selection, treeWalker.currentNode, match);
    }
  }

  function highlightOccurrences(
    selection: SelectionWithAnchorAndFocusNodes,
    textNode: Text,
    match: RegExpExecArray
  ) {
    if (!isAncestorNodeValid(textNode.parentNode)) return;

    const matchIndex = match.index;
    const selectedText = match[0];

    const range = new Range();
    range.selectNode(textNode);
    range.setStart(textNode, matchIndex);
    range.setEnd(textNode, matchIndex + selectedText.length);
    const currentHighlight = highlightInstances.get(selectionString);
    if (currentHighlight) {
      currentHighlight.highlight.add(range);
    }
  }
}

