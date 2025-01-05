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

let pressedKeys: string[] = [];
let scrollMarkersCanvasContext: CanvasRenderingContext2D;
let isNewSelection = false;
let lastSelectionString: string;
let latestRunNumber = 0;

// 记录已高亮的文本和颜色
let highlightsMap: Map<string, string> = new Map();
const colorPalette = ['#FFEB3B', '#FF4081', '#4CAF50', '#2196F3', '#9C27B0', '#FFC107']; // 高亮颜色池
let colorIndex = 0;

(async function () {
  await initOptions();
  await addStyleElement();
  scrollMarkersCanvasContext = await addScrollMarkersCanvas();
  pressedKeys = addPressedKeysListeners();
  document.addEventListener("selectstart", onSelectStart);
  document.addEventListener("selectionchange", onSelectionChange);
})();

const highlights = new Highlight();
CSS.highlights.set(highlightName(), highlights);

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
  drawScrollMarkers(runNumber);
}

function highlight(runNumber: number) {
  highlights.clear();

  const selection = document.getSelection();
  if (!isSelectionWithAnchorAndFocusNodes(selection)) return;

  const trimmedSelection = String(selection).match(trimRegex());
  if (!trimmedSelection) return;

  const leadingSpaces = trimmedSelection[1];
  const selectionString = trimmedSelection[2];
  const trailingSpaces = trimmedSelection[3];
  if (!isSelectionValid(selectionString, selection)) return;

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

    let highlightColor = highlightsMap.get(selectedText);

    if (!highlightColor) {
      highlightColor = colorPalette[colorIndex % colorPalette.length];
      highlightsMap.set(selectedText, highlightColor);
      colorIndex++; // 为下一个文本选择分配新的颜色
    }

    if (
      !isUsersSelection(
        selection,
        textNode,
        matchIndex,
        leadingSpaces,
        selectionString,
        trailingSpaces
      )
    ) {
      const range = new Range();
      range.selectNode(textNode);
      range.setStart(textNode, matchIndex);
      range.setEnd(textNode, matchIndex + selectedText.length);
      highlights.add(range, highlightColor); // 使用不同的颜色
    }
  }
}

function isUsersSelection(
  selection: SelectionWithAnchorAndFocusNodes,
  textNode: Text,
  matchIndex: number,
  leadingSpaces: string,
  selectionString: string,
  trailingSpaces: string
) {
  const anchorToFocusDirection = selection.anchorNode.compareDocumentPosition(
    selection.focusNode
  );

  function isSelectionAcrossNodesLeftToRight() {
    return anchorToFocusDirection & Node.DOCUMENT_POSITION_FOLLOWING;
  }

  function isSelectionAcrossNodesRightToLeft() {
    return anchorToFocusDirection & Node.DOCUMENT_POSITION_PRECEDING;
  }

  if (isSelectionAcrossNodesLeftToRight()) {
    if (textNode === selection.anchorNode) {
      return (
        (selection.anchorNode.nodeType === Node.ELEMENT_NODE &&
          selection.anchorOffset === 0) ||
        selection.anchorOffset <= matchIndex - leadingSpaces.length
      );
    } else if (textNode === selection.focusNode) {
      return (
        (selection.focusNode.nodeType === Node.ELEMENT_NODE &&
          selection.focusOffset === 0) ||
        selection.focusOffset >=
          matchIndex + selectionString.length + trailingSpaces.length
      );
    } else {
      return (
        selection.anchorNode.compareDocumentPosition(textNode) &
          Node.DOCUMENT_POSITION_FOLLOWING &&
        selection.focusNode.compareDocumentPosition(textNode) &
          Node.DOCUMENT_POSITION_PRECEDING
      );
    }
  } else if (isSelectionAcrossNodesRightToLeft()) {
    if (textNode === selection.anchorNode) {
      return (
        (selection.anchorNode.nodeType === Node.ELEMENT_NODE &&
          selection.anchorOffset === 0) ||
        selection.anchorOffset >=
          matchIndex + selectionString.length + trailingSpaces.length
      );
    } else if (textNode === selection.focusNode) {
      return (
        (selection.focusNode.nodeType === Node.ELEMENT_NODE &&
          selection.focusOffset === 0) ||
        selection.focusOffset <= matchIndex - leadingSpaces.length
      );
    } else {
      return (
        selection.anchorNode.compareDocumentPosition(textNode) &
          Node.DOCUMENT_POSITION_PRECEDING &&
        selection.focusNode.compareDocumentPosition(textNode) &
          Node.DOCUMENT_POSITION_FOLLOWING
      );
    }
  } else {
    if (selection.anchorOffset < selection.focusOffset) {
      return (
        textNode === selection.anchorNode &&
        selection.anchorOffset <= matchIndex - leadingSpaces.length &&
        selection.focusOffset >=
          matchIndex + selectionString.length + trailingSpaces.length
      );
    } else if (selection.anchorOffset > selection.focusOffset) {
      return (
        textNode === selection.focusNode &&
        selection.focusOffset <= matchIndex - leadingSpaces.length &&
        selection.anchorOffset >=
          matchIndex + selectionString.length + trailingSpaces.length
      );
    }
  }
}

function drawScrollMarkers(runNumber: number) {
  requestAnimationFrame(() => {
    if (runNumber !== latestRunNumber) return;
    const { width, height } = scrollMarkersCanvasContext.canvas;
    scrollMarkersCanvasContext.clearRect(0, 0, width, height);
  });

  for (let range of highlights.values()) {
    requestAnimationFrame(() => {
      if (runNumber !== latestRunNumber) return;
      const dpr = devicePixelRatio || 1;
      const clientRect = range.getBoundingClientRect();
      if (!clientRect.width || !clientRect.height) return;

      const top =
        (window.innerHeight *
          (document.documentElement.scrollTop +
            clientRect.top +
            0.5 * (clientRect.top - clientRect.bottom))) /
        document.documentElement.scrollHeight;

      scrollMarkersCanvasContext.beginPath();
      scrollMarkersCanvasContext.lineWidth = 1 * dpr;
      scrollMarkersCanvasContext.strokeStyle = "grey";
      scrollMarkersCanvasContext.fillStyle = "yellow";
      scrollMarkersCanvasContext.strokeRect(
        0.5 * dpr,
        (top + 0.5) * dpr,
        15 * dpr,
        3 * dpr
      );
      scrollMarkersCanvasContext.fillRect(
        1 * dpr,
        (top + 1) * dpr,
        14 * dpr,
        2 * dpr
      );
    });
  }
}
