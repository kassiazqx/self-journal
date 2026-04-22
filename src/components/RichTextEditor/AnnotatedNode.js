// src/components/RichTextEditor/AnnotatedNode.js
import { TextNode } from 'lexical'

/**
 * TextNode 子类，携带 CSS inline style，用于在编辑器内渲染标注。
 */
export class AnnotatedNode extends TextNode {
  __annotationStyle

  static getType() { return 'annotated' }

  static clone(node) {
    return new AnnotatedNode(node.__text, node.__annotationStyle, node.__key)
  }

  constructor(text, annotationStyle, key) {
    super(text, key)
    this.__annotationStyle = annotationStyle ?? {}
  }

  createDOM(config) {
    const dom = super.createDOM(config)
    this._applyStyle(dom)
    return dom
  }

  updateDOM(prevNode, dom, config) {
    const updated = super.updateDOM(prevNode, dom, config)
    this._applyStyle(dom)
    return updated
  }

  _applyStyle(dom) {
    const s = this.__annotationStyle
    dom.style.fontWeight              = s.fontWeight ?? ''
    dom.style.background              = s.background ?? ''
    dom.style.textDecoration          = s.textDecoration ?? ''
    dom.style.textDecorationColor     = s.textDecorationColor ?? ''
    dom.style.textDecorationStyle     = s.textDecorationStyle ?? ''
    dom.style.textDecorationThickness = s.textDecorationThickness ?? ''
    dom.style.textUnderlineOffset     = s.textUnderlineOffset ?? ''
  }

  static importJSON(node) {
    const n = new AnnotatedNode(node.text, node.annotationStyle)
    n.setFormat(node.format)
    n.setDetail(node.detail)
    n.setMode(node.mode)
    n.setStyle(node.style)
    return n
  }

  exportJSON() {
    return { ...super.exportJSON(), type: 'annotated', annotationStyle: this.__annotationStyle }
  }
}
