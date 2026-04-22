export function parseTodoText(text) {
  return splitIntoCandidateTasks(text).map((part, index) => ({
    id: index + 1,
    title: toTitle(part),
    details: part,
    status: "pending",
    resultSummary: "",
    rawOutput: "",
  }));
}

export function analyzeTodoText(text) {
  const tasks = parseTodoText(text);
  const ambiguity = detectAmbiguity(text, tasks);
  return {
    tasks,
    summary: `I interpreted your request as ${tasks.length} task${tasks.length === 1 ? "" : "s"}.`,
    needsClarification: ambiguity.needsClarification,
    clarificationPrompt: ambiguity.prompt,
  };
}

function toTitle(text) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "";
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function splitIntoCandidateTasks(text) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const numbered = splitNumberedList(normalized);
  if (numbered.length > 1) {
    return numbered;
  }

  return normalized
    .split(/[;\n]/)
    .map((part) => cleanTaskText(part))
    .filter(Boolean);
}

function splitNumberedList(text) {
  const matches = [...text.matchAll(/(?:^|\s)(\d+)[.)、]\s*/g)];
  if (matches.length < 2) {
    return [];
  }

  const parts = [];
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const piece = cleanTaskText(text.slice(start, end));
    if (piece) {
      parts.push(piece);
    }
  }
  return parts;
}

function cleanTaskText(text) {
  return text.trim().replace(/\s+/g, " ");
}

function detectAmbiguity(text, tasks) {
  const normalized = text.trim();
  const actionMatches = normalized.match(/(搜集|收集|整理|分析|画出|绘制|生成|保存|导出|research|draw|generate|save)/gi) ?? [];
  const hasSingleTask = tasks.length === 1;
  const hasManyActions = new Set(actionMatches.map((item) => item.toLowerCase())).size >= 2;

  if (hasSingleTask && hasManyActions) {
    return {
      needsClarification: true,
      prompt: "I am not confident this input maps cleanly to independent tasks.\nPlease rewrite or split the todo list before I continue.",
    };
  }

  return {
    needsClarification: false,
    prompt: "",
  };
}
