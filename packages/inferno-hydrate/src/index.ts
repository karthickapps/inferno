/**
 * @module Inferno-hydrate
 */ /** TypeDoc Comment */

import {
  options,
  IVNode,
  EMPTY_OBJ,
  mount,
  mountClassComponentCallbacks,
  mountElement,
  mountFunctionalComponentCallbacks,
  mountRef,
  mountText,
  patchProp,
  componentToDOMNodeMap,
  isControlledFormElement,
  processElement,
  IFiber,
  Fiber
} from "inferno";
import {
  isArray,
  isInvalid,
  isNull,
  isNullOrUndef,
  isObject,
  isStringOrNumber,
  throwError
} from "inferno-shared";
import VNodeFlags from "inferno-vnode-flags";

options.hydrate = hydrateRoot;

function normalizeChildNodes(parentDom) {
  let dom = parentDom.firstChild;

  while (dom) {
    if (dom.nodeType === 8) {
      if (dom.data === "!") {
        const placeholder = document.createTextNode("");

        parentDom.replaceChild(placeholder, dom);
        dom = dom.nextSibling;
      } else {
        const lastDom = dom.previousSibling;

        parentDom.removeChild(dom);
        dom = lastDom || parentDom.firstChild;
      }
    } else {
      dom = dom.nextSibling;
    }
  }
}
const svgNS = "http://www.w3.org/2000/svg";
const C = options.component;

function hydrateComponent(
  fiber: IFiber,
  vNode: IVNode,
  dom: Element,
  lifecycle,
  context,
  isSVG: boolean,
  isClass: boolean
): Element {
  const type = vNode.type;
  const ref = vNode.ref;
  const props = vNode.props || EMPTY_OBJ;
  let childFiber;

  if (isClass) {
    const _isSVG = dom.namespaceURI === svgNS;
    const instance = (C.create as Function)(
      fiber,
      vNode,
      type,
      props,
      context,
      isSVG,
      lifecycle,
      dom
    );
    fiber.c = instance;
    instance._vNode = vNode;
    childFiber = fiber.children as IFiber;

    if (!isInvalid(childFiber.input)) {
      // TODO: Can input be string?
      childFiber.dom = hydrate(
        childFiber as IFiber,
        childFiber.input as IVNode,
        dom,
        lifecycle,
        instance._childContext,
        _isSVG
      ) as Element;
    }

    mountClassComponentCallbacks(vNode, ref, instance, lifecycle);
    instance._updating = false; // Mount finished allow going sync
    if (options.findDOMNodeEnabled) {
      componentToDOMNodeMap.set(instance, dom);
    }
  } else {
    const input = (type as Function)(props, context);

    if (!isInvalid(input)) {
      childFiber = new Fiber(input, 0, null);
      fiber.children = childFiber;
      childFiber.dom = hydrate(
        childFiber,
        input,
        dom,
        lifecycle,
        context,
        isSVG
      );
    }

    mountFunctionalComponentCallbacks(props, ref, dom, lifecycle);
  }

  fiber.dom = childFiber ? childFiber.dom : null;

  return dom;
}

function hydrateElement(
  fiber: IFiber,
  vNode: IVNode,
  dom: Element,
  lifecycle,
  context: Object,
  isSVG: boolean
): Element {
  const children = vNode.children;
  const props = vNode.props;
  const className = vNode.className;
  const flags = vNode.flags;
  const ref = vNode.ref;

  isSVG = isSVG || (flags & VNodeFlags.SvgElement) > 0;
  if (dom.nodeType !== 1 || dom.tagName.toLowerCase() !== vNode.type) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "Inferno hydration: Server-side markup doesn't match client-side markup or Initial render target is not empty"
      );
    }

    const newDom = mountElement(
      fiber,
      vNode,
      dom,
      lifecycle,
      context,
      isSVG,
      false
    );
    fiber.dom = newDom;
    (dom.parentNode as Element).replaceChild(newDom, dom);

    return newDom as Element;
  }

  fiber.dom = dom;
  if (!isInvalid(children)) {
    hydrateChildren(fiber, children, dom, lifecycle, context, isSVG);
  } else if (dom.firstChild !== null) {
    dom.textContent = ""; // dom has content, but VNode has no children remove everything from DOM
  }
  if (props) {
    let hasControlledValue = false;
    const isFormElement = (flags & VNodeFlags.FormElement) > 0;
    if (isFormElement) {
      hasControlledValue = isControlledFormElement(props);
    }
    for (const prop in props) {
      // do not add a hasOwnProperty check here, it affects performance
      patchProp(prop, null, props[prop], dom, isSVG, hasControlledValue);
    }
    if (isFormElement) {
      processElement(fiber, flags, dom, props, true, hasControlledValue);
    }
  }
  if (!isNullOrUndef(className)) {
    if (isSVG) {
      dom.setAttribute("class", className);
    } else {
      dom.className = className;
    }
  } else if (dom.className !== "") {
    dom.removeAttribute("class");
  }
  if (ref) {
    mountRef(dom, ref, lifecycle);
  }
  return dom;
}

export function hydrateArrayChildren(
  dom,
  parentFiber: IFiber,
  children,
  parentDOM: Element,
  lifecycle,
  context: Object,
  isSVG: boolean,
  prefix,
  isKeyed: boolean,
  counter: number
) {
  for (let i = 0, len = children.length; i < len; i++) {
    const child = children[i];

    if (!isInvalid(child)) {
      if (isArray(child)) {
        // TODO: Add warning about nested arrays?
        dom = hydrateArrayChildren(
          dom,
          parentFiber,
          child,
          parentDOM,
          lifecycle,
          context,
          isSVG,
          prefix + i + ".",
          isKeyed,
          counter
        );
      } else {
        if (parentFiber.children === null) {
          parentFiber.children = [];
          isKeyed = isObject(child)
            ? !isNullOrUndef((child as IVNode).key)
            : false;
          parentFiber.childFlags = isKeyed ? 1 : 2;
        }
        const childFiber = new Fiber(child, prefix + i, child.key);

        (parentFiber.children as IFiber[]).push(childFiber);

        if (isNull(dom)) {
          mount(childFiber, child, parentDOM, lifecycle, context, isSVG, true);
        } else {
          const nextSibling = dom.nextSibling;
          hydrate(
            childFiber,
            child as IVNode,
            dom as Element,
            lifecycle,
            context,
            isSVG
          );
          dom = nextSibling;
        }
      }
    }
  }

  return dom;
}

function hydrateChildren(
  parentFiber: IFiber,
  children,
  parentDom: Element,
  lifecycle,
  context: Object,
  isSVG: boolean
): void {
  normalizeChildNodes(parentDom);
  let dom = parentDom.firstChild;

  if (isStringOrNumber(children)) {
    if (!isNull(dom) && dom.nodeType === 3) {
      if (dom.nodeValue !== children) {
        dom.nodeValue = children as string;
      }
    } else if (children === "") {
      parentDom.appendChild(document.createTextNode(""));
    } else {
      parentDom.textContent = children as string;
    }
    if (!isNull(dom)) {
      dom = (dom as Element).nextSibling;
    }
  } else if (isArray(children)) {
    dom = hydrateArrayChildren(
      dom,
      parentFiber,
      children,
      parentDom,
      lifecycle,
      context,
      isSVG,
      0,
      (parentFiber.childFlags & 1) > 0,
      0
    );
  } else {
    // It's VNode
    const childFiber = new Fiber(children as IVNode, 0, null);

    parentFiber.children = childFiber;

    if (!isNull(dom)) {
      hydrate(
        childFiber,
        children as IVNode,
        dom as Element,
        lifecycle,
        context,
        isSVG
      );
      dom = (dom as Element).nextSibling;
    } else {
      mount(
        childFiber,
        children as IVNode,
        parentDom,
        lifecycle,
        context,
        isSVG,
        true
      );
    }
  }

  // clear any other DOM nodes, there should be only a single entry for the root
  while (dom) {
    const nextSibling = dom.nextSibling;
    parentDom.removeChild(dom);
    dom = nextSibling;
  }
}

function hydrateText(fiber: IFiber, text: string, dom: Element): Element {
  fiber.input = text;
  if (dom.nodeType !== 3) {
    const newDom = mountText(fiber, text, null, false);

    fiber.dom = newDom;
    (dom.parentNode as Element).replaceChild(newDom, dom);
    return newDom;
  }

  if (dom.nodeValue !== text) {
    dom.nodeValue = text as string;
  }
  fiber.dom = dom;
  return dom;
}

function hydrate(
  fiber: IFiber,
  input: IVNode | string,
  dom: Element,
  lifecycle,
  context: Object,
  isSVG: boolean
) {
  if (isStringOrNumber(input)) {
    return hydrateText(fiber, input, dom);
  } else {
    // It's VNode
    const flags = input.flags;

    if (flags & VNodeFlags.Component) {
      return hydrateComponent(
        fiber,
        input,
        dom,
        lifecycle,
        context,
        isSVG,
        (flags & VNodeFlags.ComponentClass) > 0
      );
    } else if (flags & VNodeFlags.Element) {
      return hydrateElement(fiber, input, dom, lifecycle, context, isSVG);
    } else {
      if (process.env.NODE_ENV !== "production") {
        throwError(
          `hydrate() expects a valid VNode, instead it received an object with the type "${typeof input}".`
        );
      }
      throwError();
    }
  }
}

export function hydrateRoot(
  rootFiber: IFiber,
  input: IVNode | string,
  parentDom: Element | null,
  lifecycle
) {
  if (!isNull(parentDom)) {
    let dom = parentDom.firstChild as Element;

    if (!isNull(dom)) {
      hydrate(rootFiber, input, dom, lifecycle, EMPTY_OBJ, false);
      dom = parentDom.firstChild as Element;
      // clear any other DOM nodes, there should be only a single entry for the root
      while ((dom = dom.nextSibling as Element)) {
        parentDom.removeChild(dom);
      }
      return true;
    }
  }

  return false;
}