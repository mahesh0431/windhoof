export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  init?: Partial<HTMLElementTagNameMap[K]> & { text?: string },
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (init) {
    const { text, ...rest } = init;
    if (text !== undefined) node.textContent = text;
    Object.assign(node, rest);
  }
  return node;
}

export function attr(node: Element, name: string, value: string | boolean): void {
  const next = typeof value === "boolean" ? String(value) : value;
  if (node.getAttribute(name) !== next) node.setAttribute(name, next);
}

export function setText(node: Element, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}
