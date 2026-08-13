import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Link from "@tiptap/extension-link";
import { ResizableImage } from "./ResizableImage";
import { VideoEmbed, extractVideoInfo } from "./VideoEmbed";
import { FileAttachment } from "./FileAttachment";
import { AudioPlayer, setAudioPlayer } from "./AudioPlayer";
import { AudioRecorder } from "./AudioRecorder";
import { CustomHorizontalRule } from "./CustomHorizontalRule";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Dropcursor from "@tiptap/extension-dropcursor";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { common, createLowlight } from "lowlight";
import { useCallback, useEffect, useState, useRef } from "react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Highlighter,
  Code,
  List,
  ListOrdered,
  CheckSquare,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Minus,
  Image as ImageIcon,
  Type,
  AlertCircle,
  Link as LinkIcon,
  Video,
  Loader2,
  Paperclip,
  Mic,
  Table2,
  Paintbrush,
  Trash2,
  Plus,
  RowsIcon,
  Columns,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const lowlight = createLowlight(common);

interface BlockEditorProps {
  content: any;
  onChange: (content: any) => void;
  onImageUpload?: () => Promise<string | null>;
  onDocumentUpload?: (onProgress?: (progress: number) => void) => Promise<{ url: string; filename: string; filesize: number; filetype: string } | null>;
  editable?: boolean;
  title?: string;
  onTitleChange?: (title: string) => void;
  titlePlaceholder?: string;
  isFullWidth?: boolean;
}

const SLASH_COMMANDS = [
  { title: "Text", icon: Type, description: "Plain text", type: "paragraph", group: "Basic" },
  { title: "Heading 1", icon: Heading1, description: "Large heading", type: "heading", attrs: { level: 1 }, group: "Basic" },
  { title: "Heading 2", icon: Heading2, description: "Medium heading", type: "heading", attrs: { level: 2 }, group: "Basic" },
  { title: "Heading 3", icon: Heading3, description: "Small heading", type: "heading", attrs: { level: 3 }, group: "Basic" },
  { title: "Bullet List", icon: List, description: "Unordered list", type: "bulletList", group: "Lists" },
  { title: "Numbered List", icon: ListOrdered, description: "Ordered list", type: "orderedList", group: "Lists" },
  { title: "To-do List", icon: CheckSquare, description: "Task list", type: "taskList", group: "Lists" },
  { title: "Quote", icon: Quote, description: "Block quote", type: "blockquote", group: "Blocks" },
  { title: "Code Block", icon: Code, description: "Code with syntax highlighting", type: "codeBlock", group: "Blocks" },
  { title: "Divider", icon: Minus, description: "Horizontal line", type: "horizontalRule", group: "Blocks" },
  { title: "Image", icon: ImageIcon, description: "Upload or embed image", type: "image", group: "Media" },
  { title: "Video", icon: Video, description: "Embed YouTube, Zoom, or Fathom video", type: "video", group: "Media" },
  { title: "Callout", icon: AlertCircle, description: "Info callout box", type: "callout", group: "Blocks" },
];

export function BlockEditor({ content, onChange, onImageUpload, onDocumentUpload, editable = true, title, onTitleChange, titlePlaceholder = "Untitled", isFullWidth = false }: BlockEditorProps) {
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0 });
  const [slashFilter, setSlashFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [showVideoDialog, setShowVideoDialog] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
  const [documentUploadProgress, setDocumentUploadProgress] = useState(0);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [tableSize, setTableSize] = useState({ rows: 0, cols: 0 });
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [showTableColorPicker, setShowTableColorPicker] = useState(false);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        dropcursor: false,
        horizontalRule: false,
      }),
      CustomHorizontalRule,
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") {
            return `Heading ${node.attrs.level}`;
          }
          return 'Type "/" for commands...';
        },
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Underline,
      Highlight.configure({
        multicolor: true,
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      TextStyle,
      Color,
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          class: "text-primary underline underline-offset-2 cursor-pointer hover:text-primary/80",
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      ResizableImage,
      VideoEmbed,
      FileAttachment,
      AudioPlayer,
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: "javascript",
      }),
      Dropcursor.configure({
        color: "hsl(221, 83%, 53%)",
        width: 2,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            backgroundColor: {
              default: null,
              parseHTML: element => element.getAttribute('data-background-color') || element.style.backgroundColor || null,
              renderHTML: attributes => {
                if (!attributes.backgroundColor) {
                  return {};
                }
                return {
                  'data-background-color': attributes.backgroundColor,
                  style: `background-color: ${attributes.backgroundColor}`,
                };
              },
            },
          };
        },
      }),
      TableHeader.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            backgroundColor: {
              default: null,
              parseHTML: element => element.getAttribute('data-background-color') || element.style.backgroundColor || null,
              renderHTML: attributes => {
                if (!attributes.backgroundColor) {
                  return {};
                }
                return {
                  'data-background-color': attributes.backgroundColor,
                  style: `background-color: ${attributes.backgroundColor}`,
                };
              },
            },
          };
        },
      }),
    ],
    content: content || { type: "doc", content: [{ type: "paragraph" }] },
    editable,
    onCreate: () => {
      setIsInitialized(true);
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON());
    },
    editorProps: {
      attributes: {
        class: "tiptap-editor outline-none min-h-[200px] prose prose-sm dark:prose-invert max-w-none",
      },
      handleKeyDown: (view, event) => {
        if (showSlashMenu) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
            return true;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            handleCommandSelect(filteredCommands[selectedIndex]);
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setShowSlashMenu(false);
            return true;
          }
        }

        if (event.key === "/" && !showSlashMenu) {
          const { from } = view.state.selection;
          const $pos = view.state.doc.resolve(from);
          const textBefore = $pos.parent.textContent.slice(0, $pos.parentOffset);
          
          if (textBefore === "" || textBefore.endsWith(" ")) {
            setTimeout(() => {
              const coords = view.coordsAtPos(from);
              const containerRect = editorContainerRef.current?.getBoundingClientRect();
              
              if (containerRect) {
                // Calculate position relative to container
                const menuTop = coords.bottom - containerRect.top + 8;
                const menuLeft = Math.max(0, coords.left - containerRect.left);
                
                setSlashMenuPosition({
                  top: menuTop,
                  left: menuLeft,
                });
              }
              setShowSlashMenu(true);
              setSlashFilter("");
              setSelectedIndex(0);
            }, 0);
          }
        }

        return false;
      },
    },
  });

  const filteredCommands = SLASH_COMMANDS.filter((cmd) =>
    cmd.title.toLowerCase().includes(slashFilter.toLowerCase()) ||
    cmd.description.toLowerCase().includes(slashFilter.toLowerCase())
  );

  const handleCommandSelect = useCallback(async (command: typeof SLASH_COMMANDS[0]) => {
    if (!editor) return;

    const { from } = editor.state.selection;
    const $pos = editor.state.doc.resolve(from);
    const textBefore = $pos.parent.textContent.slice(0, $pos.parentOffset);
    const slashIndex = textBefore.lastIndexOf("/");
    
    if (slashIndex >= 0) {
      editor.chain().focus(undefined, { scrollIntoView: false }).deleteRange({
        from: from - (textBefore.length - slashIndex),
        to: from,
      }).run();
    }

    setShowSlashMenu(false);
    setSlashFilter("");

    switch (command.type) {
      case "paragraph":
        editor.chain().focus(undefined, { scrollIntoView: false }).setParagraph().run();
        break;
      case "heading":
        editor.chain().focus(undefined, { scrollIntoView: false }).toggleHeading({ level: command.attrs?.level as 1 | 2 | 3 }).run();
        break;
      case "bulletList":
        editor.chain().focus(undefined, { scrollIntoView: false }).toggleBulletList().run();
        break;
      case "orderedList":
        editor.chain().focus(undefined, { scrollIntoView: false }).toggleOrderedList().run();
        break;
      case "taskList":
        editor.chain().focus(undefined, { scrollIntoView: false }).toggleTaskList().run();
        break;
      case "blockquote":
        editor.chain().focus(undefined, { scrollIntoView: false }).toggleBlockquote().run();
        break;
      case "codeBlock":
        editor.chain().focus(undefined, { scrollIntoView: false }).toggleCodeBlock().run();
        break;
      case "horizontalRule":
        editor.chain().focus(undefined, { scrollIntoView: false }).setHorizontalRule().run();
        break;
      case "image":
        if (onImageUpload) {
          // Save cursor position before opening file picker
          const { from, to } = editor.state.selection;
          savedSelectionRef.current = { from, to };
          setIsUploadingImage(true);
          try {
            const url = await onImageUpload();
            if (url && savedSelectionRef.current) {
              // Insert image directly at the saved position without scrolling
              editor.chain()
                .insertContentAt(savedSelectionRef.current.from, {
                  type: 'image',
                  attrs: { src: url }
                })
                .focus(undefined, { scrollIntoView: false })
                .run();
            } else if (url) {
              editor.chain().focus(undefined, { scrollIntoView: false }).setImage({ src: url }).run();
            }
          } finally {
            setIsUploadingImage(false);
            savedSelectionRef.current = null;
          }
        }
        break;
      case "video":
        // Save cursor position before opening dialog
        savedSelectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to };
        setShowVideoDialog(true);
        break;
      case "callout":
        editor.chain().focus(undefined, { scrollIntoView: false }).insertContent({
          type: "blockquote",
          content: [{ type: "paragraph" }],
        }).run();
        break;
    }
  }, [editor, onImageUpload]);

  const handleAddLink = useCallback(() => {
    if (!editor) return;
    
    // Save cursor position before opening dialog
    savedSelectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to };
    const previousUrl = editor.getAttributes("link").href;
    setLinkUrl(previousUrl || "");
    setShowLinkDialog(true);
  }, [editor]);

  const handleLinkSubmit = useCallback(() => {
    if (!editor || !linkUrl) {
      setShowLinkDialog(false);
      setLinkUrl("");
      savedSelectionRef.current = null;
      return;
    }

    let url = linkUrl;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    // Restore cursor position and apply link without scrolling
    if (savedSelectionRef.current) {
      editor.chain()
        .focus(undefined, { scrollIntoView: false })
        .setTextSelection({ from: savedSelectionRef.current.from, to: savedSelectionRef.current.to })
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    } else {
      editor.chain().focus(undefined, { scrollIntoView: false }).extendMarkRange("link").setLink({ href: url }).run();
    }
    setShowLinkDialog(false);
    setLinkUrl("");
    savedSelectionRef.current = null;
  }, [editor, linkUrl]);

  const handleRemoveLink = useCallback(() => {
    if (!editor) return;
    // Restore cursor position and remove link without scrolling
    if (savedSelectionRef.current) {
      editor.chain()
        .focus(undefined, { scrollIntoView: false })
        .setTextSelection({ from: savedSelectionRef.current.from, to: savedSelectionRef.current.to })
        .unsetLink()
        .run();
    } else {
      editor.chain().focus(undefined, { scrollIntoView: false }).unsetLink().run();
    }
    setShowLinkDialog(false);
    setLinkUrl("");
    savedSelectionRef.current = null;
  }, [editor]);

  const handleVideoSubmit = useCallback(() => {
    if (!editor || !videoUrl) {
      setShowVideoDialog(false);
      setVideoUrl("");
      savedSelectionRef.current = null;
      return;
    }

    const videoInfo = extractVideoInfo(videoUrl);
    if (videoInfo) {
      // Restore cursor position and insert video there without scrolling
      if (savedSelectionRef.current) {
        editor.chain()
          .focus(undefined, { scrollIntoView: false })
          .setTextSelection(savedSelectionRef.current.from)
          .setVideoEmbed(videoUrl)
          .run();
      } else {
        editor.chain().focus(undefined, { scrollIntoView: false }).setVideoEmbed(videoUrl).run();
      }
    }
    setShowVideoDialog(false);
    setVideoUrl("");
    savedSelectionRef.current = null;
  }, [editor, videoUrl]);

  useEffect(() => {
    if (!editor) return;

    const handleInput = () => {
      if (showSlashMenu) {
        const { from } = editor.state.selection;
        const $pos = editor.state.doc.resolve(from);
        const textBefore = $pos.parent.textContent.slice(0, $pos.parentOffset);
        const slashIndex = textBefore.lastIndexOf("/");
        
        if (slashIndex === -1) {
          setShowSlashMenu(false);
        } else {
          setSlashFilter(textBefore.slice(slashIndex + 1));
          setSelectedIndex(0);
        }
      }
    };

    editor.on("update", handleInput);
    return () => {
      editor.off("update", handleInput);
    };
  }, [editor, showSlashMenu]);

  useEffect(() => {
    const handleClickOutside = () => {
      if (showSlashMenu) {
        setShowSlashMenu(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [showSlashMenu]);

  // Adjust slash menu position if it would go off-screen
  useEffect(() => {
    if (!showSlashMenu || !slashMenuRef.current || !editorContainerRef.current) return;

    const menu = slashMenuRef.current;
    const container = editorContainerRef.current;
    const menuRect = menu.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    let newTop = slashMenuPosition.top;
    let newLeft = slashMenuPosition.left;

    // If menu goes below viewport, position it above the cursor
    if (menuRect.bottom > viewportHeight - 20) {
      const cursorTop = containerRect.top + slashMenuPosition.top - 8;
      newTop = slashMenuPosition.top - menuRect.height - 40;
    }

    // If menu goes beyond right edge, shift it left
    if (menuRect.right > viewportWidth - 20) {
      newLeft = Math.max(0, containerRect.width - menuRect.width - 20);
    }

    if (newTop !== slashMenuPosition.top || newLeft !== slashMenuPosition.left) {
      setSlashMenuPosition({ top: Math.max(0, newTop), left: newLeft });
    }
  }, [showSlashMenu, slashMenuPosition.top, slashMenuPosition.left]);

  // Sync editor content when content prop changes (e.g., when navigating back to a page)
  useEffect(() => {
    if (!editor || !isInitialized) return;
    
    // Use setTimeout to avoid flushSync warning when called during render
    const timeoutId = setTimeout(() => {
      const currentContent = editor.getJSON();
      const newContent = content || { type: "doc", content: [{ type: "paragraph" }] };
      
      // Only update if the content is different from what's in the editor
      if (JSON.stringify(currentContent) !== JSON.stringify(newContent)) {
        // Save cursor position before updating content
        const { from, to } = editor.state.selection;
        const docSize = editor.state.doc.content.size;
        
        editor.commands.setContent(newContent, { emitUpdate: false });
        
        // Restore cursor position after content update, ensuring it's within bounds
        const newDocSize = editor.state.doc.content.size;
        const safeFrom = Math.min(from, newDocSize);
        const safeTo = Math.min(to, newDocSize);
        
        // Only restore if the document still has content and position is valid
        if (safeFrom > 0 && newDocSize > 0) {
          editor.commands.setTextSelection({ from: safeFrom, to: safeTo });
        }
      }
    }, 0);
    
    return () => clearTimeout(timeoutId);
  }, [editor, content, isInitialized]);

  if (!editor) return null;

  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.group]) acc[cmd.group] = [];
    acc[cmd.group].push(cmd);
    return acc;
  }, {} as Record<string, typeof SLASH_COMMANDS>);

  return (
    <div ref={editorContainerRef} className="flex flex-col h-full" data-testid="block-editor">
      <div className={cn("sticky top-0 z-50 bg-background border-b border-border flex-shrink-0", isFullWidth ? "-mx-8 px-8" : "-mx-4 md:-mx-6 px-4 md:px-6")} data-testid="editor-sticky-header">
        {title !== undefined && onTitleChange && (
          <Input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={titlePlaceholder}
            className="text-2xl md:text-4xl font-bold border-0 px-0 py-0 focus-visible:ring-0 placeholder:text-muted-foreground/50 pt-4 md:pt-8 w-full bg-transparent !h-auto"
            data-testid="input-document-title"
          />
        )}
        <div className="pt-0 pb-2 flex items-center gap-1 flex-wrap" data-testid="editor-toolbar">
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", editor.isActive("bold") && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleBold().run()}
          data-testid="button-bold"
        >
          <Bold className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", editor.isActive("italic") && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleItalic().run()}
          data-testid="button-italic"
        >
          <Italic className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", editor.isActive("underline") && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleUnderline().run()}
          data-testid="button-underline"
        >
          <UnderlineIcon className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", editor.isActive("strike") && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleStrike().run()}
          data-testid="button-strike"
        >
          <Strikethrough className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", editor.isActive("highlight") && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleHighlight().run()}
          data-testid="button-highlight"
        >
          <Highlighter className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", editor.isActive("code") && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleCode().run()}
          data-testid="button-code"
        >
          <Code className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", editor.isActive("link") && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleAddLink}
          data-testid="button-link"
        >
          <LinkIcon className="w-4 h-4" />
        </Button>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", editor.isActive("heading", { level: 1 }) && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleHeading({ level: 1 }).run()}
          data-testid="button-h1"
        >
          <Heading1 className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", editor.isActive("heading", { level: 2 }) && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleHeading({ level: 2 }).run()}
          data-testid="button-h2"
        >
          <Heading2 className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", editor.isActive("heading", { level: 3 }) && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleHeading({ level: 3 }).run()}
          data-testid="button-h3"
        >
          <Heading3 className="w-4 h-4" />
        </Button>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", editor.isActive("bulletList") && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleBulletList().run()}
          data-testid="button-bullet-list"
        >
          <List className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", editor.isActive("orderedList") && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleOrderedList().run()}
          data-testid="button-ordered-list"
        >
          <ListOrdered className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", editor.isActive("taskList") && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleTaskList().run()}
          data-testid="button-task-list"
        >
          <CheckSquare className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", editor.isActive("blockquote") && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleBlockquote().run()}
          data-testid="button-blockquote"
        >
          <Quote className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", editor.isActive("codeBlock") && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleCodeBlock().run()}
          data-testid="button-code-block"
        >
          <Code className="w-4 h-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onMouseDown={(e) => e.preventDefault()}
              data-testid="button-horizontal-rule"
            >
              <Minus className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[140px]">
            <DropdownMenuItem
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.chain().focus(undefined, { scrollIntoView: false }).setHorizontalRule({ width: "thin" }).run();
              }}
              className="flex items-center gap-2"
              data-testid="hr-thin"
            >
              <div className="flex-1 h-[1px] bg-foreground" />
              <span className="text-xs text-muted-foreground shrink-0">Thin</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.chain().focus(undefined, { scrollIntoView: false }).setHorizontalRule({ width: "medium" }).run();
              }}
              className="flex items-center gap-2"
              data-testid="hr-medium"
            >
              <div className="flex-1 h-[2px] bg-foreground" />
              <span className="text-xs text-muted-foreground shrink-0">Medium</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.chain().focus(undefined, { scrollIntoView: false }).setHorizontalRule({ width: "thick" }).run();
              }}
              className="flex items-center gap-2"
              data-testid="hr-thick"
            >
              <div className="flex-1 h-[4px] bg-foreground" />
              <span className="text-xs text-muted-foreground shrink-0">Thick</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover open={showTablePicker} onOpenChange={setShowTablePicker}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8", editor.isActive("table") && "bg-accent")}
              onMouseDown={(e) => e.preventDefault()}
              data-testid="button-table"
            >
              <Table2 className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-3" onOpenAutoFocus={(e) => e.preventDefault()}>
            <div className="space-y-2">
              <p className="text-sm font-medium text-center">
                {tableSize.rows > 0 && tableSize.cols > 0 
                  ? `${tableSize.rows} x ${tableSize.cols}` 
                  : "Select table size"}
              </p>
              <div 
                className="grid gap-0.5"
                style={{ gridTemplateColumns: `repeat(8, 1fr)` }}
                onMouseLeave={() => setTableSize({ rows: 0, cols: 0 })}
              >
                {Array.from({ length: 8 * 8 }).map((_, i) => {
                  const row = Math.floor(i / 8) + 1;
                  const col = (i % 8) + 1;
                  const isSelected = row <= tableSize.rows && col <= tableSize.cols;
                  return (
                    <div
                      key={i}
                      className={cn(
                        "w-5 h-5 border border-border rounded-sm cursor-pointer transition-colors",
                        isSelected ? "bg-primary" : "bg-muted/30 hover:bg-muted"
                      )}
                      onMouseEnter={() => setTableSize({ rows: row, cols: col })}
                      onClick={() => {
                        editor.chain().focus(undefined, { scrollIntoView: false }).insertTable({ 
                          rows: row, 
                          cols: col, 
                          withHeaderRow: true 
                        }).run();
                        setShowTablePicker(false);
                        setTableSize({ rows: 0, cols: 0 });
                      }}
                      data-testid={`table-cell-${row}-${col}`}
                    />
                  );
                })}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {editor.isActive("table") && (
          <>
            <Popover open={showTableColorPicker} onOpenChange={setShowTableColorPicker}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onMouseDown={(e) => e.preventDefault()}
                  data-testid="button-table-color"
                >
                  <Paintbrush className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-3" onOpenAutoFocus={(e) => e.preventDefault()}>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Cell Background</p>
                  <div className="grid grid-cols-6 gap-1">
                    {[
                      { color: "transparent", label: "None" },
                      { color: "#fef3c7", label: "Yellow" },
                      { color: "#dcfce7", label: "Green" },
                      { color: "#dbeafe", label: "Blue" },
                      { color: "#fce7f3", label: "Pink" },
                      { color: "#f3e8ff", label: "Purple" },
                      { color: "#fed7aa", label: "Orange" },
                      { color: "#fecaca", label: "Red" },
                      { color: "#e5e7eb", label: "Gray" },
                      { color: "#cffafe", label: "Cyan" },
                      { color: "#d1fae5", label: "Teal" },
                      { color: "#fef9c3", label: "Lime" },
                    ].map(({ color, label }) => (
                      <button
                        key={color}
                        className={cn(
                          "w-6 h-6 rounded border border-border cursor-pointer hover:scale-110 transition-transform",
                          color === "transparent" && "bg-[repeating-linear-gradient(45deg,#ccc,#ccc_2px,transparent_2px,transparent_8px)]"
                        )}
                        style={{ backgroundColor: color !== "transparent" ? color : undefined }}
                        title={label}
                        onClick={() => {
                          const { state, view } = editor;
                          const { selection } = state;
                          const { $from } = selection;
                          
                          // Find the table cell at current position
                          let cellPos: number | null = null;
                          let cellNode: any = null;
                          
                          for (let depth = $from.depth; depth >= 0; depth--) {
                            const node = $from.node(depth);
                            if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
                              cellPos = $from.before(depth);
                              cellNode = node;
                              break;
                            }
                          }
                          
                          if (cellPos !== null && cellNode) {
                            const tr = state.tr;
                            const newAttrs = {
                              ...cellNode.attrs,
                              backgroundColor: color === "transparent" ? null : color,
                            };
                            tr.setNodeMarkup(cellPos, undefined, newAttrs);
                            view.dispatch(tr);
                          }
                          
                          setShowTableColorPicker(false);
                          editor.commands.focus();
                        }}
                        data-testid={`table-color-${label.toLowerCase()}`}
                      />
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().addRowAfter().run()}
              title="Add row"
              data-testid="button-add-row"
            >
              <RowsIcon className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              title="Add column"
              data-testid="button-add-column"
            >
              <Columns className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().deleteTable().run()}
              title="Delete table"
              data-testid="button-delete-table"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </>
        )}

        <Separator orientation="vertical" className="mx-1 h-6" />

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={isUploadingImage}
          onMouseDown={(e) => e.preventDefault()}
          onClick={async () => {
            if (onImageUpload && !isUploadingImage) {
              // Save cursor position before opening file picker
              const { from, to } = editor.state.selection;
              savedSelectionRef.current = { from, to };
              setIsUploadingImage(true);
              try {
                const url = await onImageUpload();
                if (url && savedSelectionRef.current) {
                  // Insert image directly at the saved position without scrolling
                  editor.chain()
                    .insertContentAt(savedSelectionRef.current.from, {
                      type: 'image',
                      attrs: { src: url }
                    })
                    .focus(undefined, { scrollIntoView: false })
                    .run();
                } else if (url) {
                  editor.chain().focus(undefined, { scrollIntoView: false }).setImage({ src: url }).run();
                }
              } finally {
                setIsUploadingImage(false);
                savedSelectionRef.current = null;
              }
            }
          }}
          data-testid="button-image"
        >
          {isUploadingImage ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ImageIcon className="w-4 h-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            // Save cursor position before opening dialog
            savedSelectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to };
            setShowVideoDialog(true);
          }}
          data-testid="button-video"
        >
          <Video className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={isUploadingDocument}
          onMouseDown={(e) => e.preventDefault()}
          onClick={async () => {
            if (onDocumentUpload && !isUploadingDocument) {
              const { from, to } = editor.state.selection;
              savedSelectionRef.current = { from, to };
              setIsUploadingDocument(true);
              setDocumentUploadProgress(0);
              try {
                const result = await onDocumentUpload((progress) => {
                  setDocumentUploadProgress(progress);
                });
                if (result && savedSelectionRef.current) {
                  editor.chain()
                    .focus(undefined, { scrollIntoView: false })
                    .setTextSelection(savedSelectionRef.current.from)
                    .setFileAttachment({
                      src: result.url,
                      filename: result.filename,
                      filesize: result.filesize,
                      filetype: result.filetype,
                    })
                    .run();
                }
              } finally {
                setIsUploadingDocument(false);
                setDocumentUploadProgress(0);
                savedSelectionRef.current = null;
              }
            }
          }}
          data-testid="button-attach"
        >
          {isUploadingDocument ? (
            <div className="relative w-6 h-6 flex items-center justify-center">
              <svg className="w-6 h-6 transform -rotate-90" viewBox="0 0 24 24">
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  opacity="0.2"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray={2 * Math.PI * 10}
                  strokeDashoffset={2 * Math.PI * 10 * (1 - documentUploadProgress / 100)}
                  strokeLinecap="round"
                  className="text-primary transition-all duration-150"
                />
              </svg>
              <span className="absolute text-[8px] font-medium">{documentUploadProgress}%</span>
            </div>
          ) : (
            <Paperclip className="w-4 h-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", isRecordingAudio && "bg-accent")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            savedSelectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to };
            setIsRecordingAudio(true);
          }}
          data-testid="button-record-audio"
        >
          <Mic className="w-4 h-4" />
        </Button>
        </div>
      </div>

      {isRecordingAudio && (
        <div className="px-4 pb-2">
          <AudioRecorder
            isUploading={isUploadingAudio}
            onCancel={() => {
              setIsRecordingAudio(false);
              savedSelectionRef.current = null;
            }}
            onRecordingComplete={async (audioBlob) => {
              setIsUploadingAudio(true);
              try {
                const uploadUrlRes = await fetch("/api/objects/upload", {
                  method: "POST",
                  credentials: "include",
                });
                if (!uploadUrlRes.ok) throw new Error("Failed to get upload URL");
                const { uploadURL, objectPath } = await uploadUrlRes.json();

                const uploadRes = await fetch(uploadURL, {
                  method: "PUT",
                  body: audioBlob,
                  headers: { "Content-Type": "audio/webm" },
                });
                if (!uploadRes.ok) throw new Error("Failed to upload audio");

                const audioRes = await fetch("/api/audio/upload", {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ audioUrl: objectPath }),
                });
                if (!audioRes.ok) throw new Error("Failed to save audio");
                const audioData = await audioRes.json();

                if (savedSelectionRef.current) {
                  setAudioPlayer(editor, {
                    src: audioData.audioUrl,
                    transcriptStatus: "processing",
                    recordingId: audioData.id,
                  });
                }

                setIsRecordingAudio(false);
              } catch (error) {
                console.error("Error uploading audio:", error);
              } finally {
                setIsUploadingAudio(false);
                savedSelectionRef.current = null;
              }
            }}
          />
        </div>
      )}

      <div className="relative flex-1 overflow-auto pt-4">
        <EditorContent editor={editor} />

        {showSlashMenu && filteredCommands.length > 0 && (
        <div
          ref={slashMenuRef}
          className="slash-menu absolute z-50"
          style={{ 
            top: slashMenuPosition.top, 
            left: slashMenuPosition.left,
            maxHeight: '320px',
            overflowY: 'auto'
          }}
          onClick={(e) => e.stopPropagation()}
          data-testid="slash-menu"
        >
          {Object.entries(groupedCommands).map(([group, commands]) => (
            <div key={group}>
              <div className="slash-menu-group">{group}</div>
              {commands.map((cmd) => {
                const globalIdx = filteredCommands.indexOf(cmd);
                return (
                  <button
                    key={cmd.title}
                    className={cn(
                      "slash-menu-item w-full",
                      globalIdx === selectedIndex && "selected"
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleCommandSelect(cmd)}
                    data-testid={`slash-command-${cmd.type}`}
                  >
                    <cmd.icon className="slash-menu-item-icon" />
                    <div className="flex-1">
                      <p className="font-medium text-sm">{cmd.title}</p>
                      <p className="text-xs text-muted-foreground">{cmd.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        )}
      </div>

      <Dialog 
        open={showLinkDialog} 
        onOpenChange={(open) => {
          setShowLinkDialog(open);
          if (!open) setLinkUrl("");
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="link-dialog">
          <DialogHeader>
            <DialogTitle>Insert Link</DialogTitle>
            <DialogDescription>
              Add a hyperlink to the selected text. The link will open in a new tab.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="link-url">URL</Label>
              <Input
                id="link-url"
                placeholder="https://example.com"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleLinkSubmit();
                  }
                }}
                aria-describedby="link-url-hint"
                data-testid="input-link-url"
              />
              <p id="link-url-hint" className="text-xs text-muted-foreground">
                Enter a valid URL starting with http:// or https://
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            {editor?.isActive("link") && (
              <Button
                variant="destructive"
                onClick={handleRemoveLink}
                aria-label="Remove link"
                data-testid="button-remove-link"
              >
                Remove Link
              </Button>
            )}
            <Button onClick={handleLinkSubmit} aria-label="Save link" data-testid="button-save-link">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog 
        open={showVideoDialog} 
        onOpenChange={(open) => {
          setShowVideoDialog(open);
          if (!open) setVideoUrl("");
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="video-dialog">
          <DialogHeader>
            <DialogTitle>Embed Video</DialogTitle>
            <DialogDescription>
              Paste a video URL to embed it in your document.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="video-url">Video URL</Label>
              <Input
                id="video-url"
                placeholder="https://youtube.com/watch?v=... or Zoom/Fathom link"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleVideoSubmit();
                  }
                }}
                aria-describedby="video-url-hint"
                data-testid="input-video-url"
              />
              <p id="video-url-hint" className="text-xs text-muted-foreground">
                Supports YouTube, Zoom recordings, and Fathom
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleVideoSubmit} aria-label="Insert video" data-testid="button-save-video">
              Insert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
