import { Node, mergeAttributes } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    customHorizontalRule: {
      setHorizontalRule: (options?: { width?: "thin" | "medium" | "thick" }) => ReturnType;
    };
  }
}

export interface HorizontalRuleOptions {
  HTMLAttributes: Record<string, any>;
}

export const CustomHorizontalRule = Node.create<HorizontalRuleOptions>({
  name: "horizontalRule",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: "block",

  parseHTML() {
    return [{ tag: "hr" }];
  },

  addAttributes() {
    return {
      width: {
        default: "medium",
        parseHTML: (element) => element.getAttribute("data-width") || "medium",
        renderHTML: (attributes) => {
          return {
            "data-width": attributes.width,
          };
        },
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return ["hr", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },

  addCommands() {
    return {
      setHorizontalRule:
        (options?: { width?: "thin" | "medium" | "thick" }) =>
        ({ tr, dispatch, state }) => {
          const { selection } = state;
          const { $from } = selection;
          
          const node = this.type.create({ width: options?.width || "medium" });
          
          if (dispatch) {
            const pos = $from.pos;
            tr.insert(pos, node);
            
            const newPos = pos + 1;
            if (tr.doc.nodeSize > newPos + 1) {
              tr.setSelection(TextSelection.create(tr.doc, newPos));
            }
          }
          
          return true;
        },
    };
  },
});
