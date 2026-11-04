// Just enough of a browser DOM for react-dom/client to mount the main view in Node and run its effects (the project
// has no jsdom, and no new dependencies). Elements keep children, attributes, style, listeners and scroll offsets;
// layout is all zeros, selectors match nothing. Events go to the listeners React put on the root container.
import { vi } from 'vitest';

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_NODE = 9;

type Listener = { type: string; fn: (event: FakeEvent) => void; capture: boolean };

export interface FakeEvent {
  type: string;
  target: FakeNode;
  bubbles: boolean;
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

export class FakeNode {
  parentNode: FakeElement | null = null;
  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
    readonly ownerDocument: FakeDocument | null,
  ) {}
  get parentElement(): FakeElement | null {
    return this.parentNode;
  }
  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get textContent(): string {
    return '';
  }
}

class FakeText extends FakeNode {
  constructor(
    public nodeValue: string,
    doc: FakeDocument,
  ) {
    super(TEXT_NODE, '#text', doc);
  }
  override get textContent(): string {
    return this.nodeValue;
  }
}

function makeStyle(): Record<string, unknown> {
  const style: Record<string, unknown> = {};
  style.setProperty = (name: string, value: string) => void (style[name] = value);
  style.removeProperty = (name: string) => void delete style[name];
  style.getPropertyValue = (name: string) => String(style[name] ?? '');
  return style;
}

export class FakeElement extends FakeNode {
  childNodes: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly style = makeStyle();
  readonly listeners: Listener[] = [];
  readonly tagName: string;
  scrollTop = 0;
  scrollLeft = 0;
  clientWidth = 0;
  clientHeight = 0;
  scrollWidth = 0;
  scrollHeight = 0;
  innerHTML = '';
  value = '';
  constructor(
    readonly localName: string,
    doc: FakeDocument,
    readonly namespaceURI: string,
  ) {
    super(ELEMENT_NODE, namespaceURI === HTML_NS ? localName.toUpperCase() : localName, doc);
    this.tagName = this.nodeName;
  }
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): FakeNode | null {
    return this.childNodes.at(-1) ?? null;
  }
  get children(): FakeElement[] {
    return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
  }
  override get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  override set textContent(text: string) {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = [];
    if (text && this.ownerDocument) this.appendChild(this.ownerDocument.createTextNode(text));
  }
  get id(): string {
    return this.getAttribute('id') ?? '';
  }
  get className(): string {
    return this.getAttribute('class') ?? '';
  }
  get classList(): { contains: (name: string) => boolean } {
    return { contains: (name) => this.className.split(/\s+/).includes(name) };
  }
  appendChild<T extends FakeNode>(child: T): T {
    child.parentNode?.removeChild(child);
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }
  insertBefore<T extends FakeNode>(child: T, before: FakeNode | null): T {
    if (!before) return this.appendChild(child);
    child.parentNode?.removeChild(child);
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild<T extends FakeNode>(child: T): T {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  contains(node: FakeNode | null): boolean {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value));
  }
  setAttributeNS(_ns: string | null, name: string, value: unknown): void {
    this.setAttribute(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  removeAttributeNS(_ns: string | null, name: string): void {
    this.removeAttribute(name);
  }
  addEventListener(type: string, fn: Listener['fn'], options?: boolean | { capture?: boolean }): void {
    this.listeners.push({ type, fn, capture: typeof options === 'boolean' ? options : !!options?.capture });
  }
  removeEventListener(type: string, fn: Listener['fn'], options?: boolean | { capture?: boolean }): void {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    const i = this.listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
    if (i >= 0) this.listeners.splice(i, 1);
  }
  scrollTo(options: { top?: number; left?: number }): void {
    if (options.top !== undefined) this.scrollTop = options.top;
    if (options.left !== undefined) this.scrollLeft = options.left;
  }
  scrollIntoView(): void {}
  focus(): void {}
  blur(): void {}
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  getContext(): null {
    return null; // no canvas: text widths fall back to a guess
  }
  querySelector(): null {
    return null;
  }
  querySelectorAll(): FakeElement[] {
    return [];
  }
  closest(): null {
    return null;
  }
  matches(): boolean {
    return false;
  }
}

export class FakeDocument extends FakeNode {
  readonly documentElement: FakeElement;
  readonly head: FakeElement;
  readonly body: FakeElement;
  readonly activeElement = null; // nothing takes focus, so React has no focus to restore after a commit
  readonly fonts = { check: () => false };
  title = '';
  constructor() {
    super(DOCUMENT_NODE, '#document', null);
    this.documentElement = this.createElement('html');
    this.head = this.documentElement.appendChild(this.createElement('head'));
    this.body = this.documentElement.appendChild(this.createElement('body'));
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this, HTML_NS);
  }
  createElementNS(ns: string, tag: string): FakeElement {
    return new FakeElement(tag, this, ns);
  }
  createTextNode(text: string): FakeText {
    return new FakeText(text, this);
  }
  getElementById(id: string): FakeElement | null {
    return findAll(this.documentElement, (el) => el.id === id)[0] ?? null;
  }
  elementFromPoint(): null {
    return null;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  querySelector(): null {
    return null;
  }
  querySelectorAll(): FakeElement[] {
    return [];
  }
}

/** Every element under `root` (itself included) that passes `test`, in document order. */
export function findAll(root: FakeElement, test: (el: FakeElement) => boolean): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (el: FakeElement) => {
    if (test(el)) found.push(el);
    el.children.forEach(walk);
  };
  walk(root);
  return found;
}

export const hasClass = (name: string) => (el: FakeElement) => el.classList.contains(name);

/** A bubbling event on `target`, as the browser would deliver it: capture listeners top-down, then bubble ones up. */
export function fire(target: FakeElement, type: string, init: Partial<Pick<FakeEvent, 'shiftKey' | 'ctrlKey' | 'button'>> = {}): FakeEvent {
  const event: FakeEvent = {
    type,
    target,
    bubbles: true,
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault: () => void (event.defaultPrevented = true),
    stopPropagation: () => {},
    ...init,
  };
  const path: FakeElement[] = [];
  for (let n: FakeElement | null = target; n; n = n.parentNode) path.push(n);
  const run = (el: FakeElement, capture: boolean) => el.listeners.filter((l) => l.type === type && l.capture === capture).forEach((l) => l.fn(event));
  [...path].reverse().forEach((el) => run(el, true));
  path.forEach((el) => run(el, false));
  return event;
}

/** Puts the fake `window` and `document` (and the few browser globals the app reads) in place; undone by vi.unstubAllGlobals. */
export function installFakeDom(): FakeDocument {
  const document = new FakeDocument();
  const noop = () => {};
  const computed = () => ({ getPropertyValue: () => '', fontFamily: '' });
  const frame = (run: () => void) => setTimeout(run, 0);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', {
    document,
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener: noop,
    removeEventListener: noop,
    getComputedStyle: computed,
    requestAnimationFrame: frame,
    cancelAnimationFrame: clearTimeout,
    HTMLIFrameElement: class {},
  });
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('Node', FakeNode);
  vi.stubGlobal('getComputedStyle', computed);
  vi.stubGlobal('requestAnimationFrame', frame);
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  return document;
}
