import { useState, useRef, useEffect, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Paperclip, X, FileText, Image as ImageIcon, Video, Music, File } from "lucide-react";
import type { SafeUser } from "@shared/schema";

export interface NoteAttachment {
  url: string;
  filename: string;
  filesize: number;
  filetype: string;
}

interface NoteInputProps {
  value: string;
  onChange: (value: string) => void;
  users: SafeUser[];
  mentionedUserIds: string[];
  onMentionAdd: (userId: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
  testId?: string;
  autoFocus?: boolean;
  attachments?: NoteAttachment[];
  onAttachmentsChange?: (attachments: NoteAttachment[]) => void;
  showAttachButton?: boolean;
}

interface StagedFile {
  file: File;
  id: string;
  uploading: boolean;
  progress: number;
  error?: string;
}

export function NoteInput({
  value,
  onChange,
  users,
  mentionedUserIds,
  onMentionAdd,
  onSubmit,
  placeholder = "Add a note... (type @ to mention)",
  className = "",
  testId,
  autoFocus = false,
  attachments = [],
  onAttachmentsChange,
  showAttachButton = true,
}: NoteInputProps) {
  const [isFocused, setIsFocused] = useState(autoFocus);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentionStartPos, setMentionStartPos] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const getUserDisplayName = (user: SafeUser) => {
    const name = `${user.firstName || ""} ${user.lastName || ""}`.trim();
    return name || user.email || "Unknown";
  };

  const filteredUsers = users.filter((user) => {
    const displayName = getUserDisplayName(user).toLowerCase();
    const email = (user.email || "").toLowerCase();
    return displayName.includes(mentionSearch) || email.includes(mentionSearch);
  });

  useEffect(() => {
    setSelectedIndex(0);
  }, [mentionSearch]);

  useEffect(() => {
    if (showMentionDropdown && itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [selectedIndex, showMentionDropdown]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        editorRef.current &&
        !editorRef.current.contains(e.target as Node)
      ) {
        setShowMentionDropdown(false);
        setMentionStartPos(null);
      }
    };

    if (showMentionDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showMentionDropdown]);

  const getCaretPosition = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    
    const range = sel.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(editorRef.current!);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    return preCaretRange.toString().length;
  };

  const setCaretPosition = (pos: number) => {
    if (!editorRef.current) return;
    
    const sel = window.getSelection();
    if (!sel) return;
    
    let currentPos = 0;
    const nodeStack: Node[] = [editorRef.current];
    let node: Node | undefined;
    let foundNode: Node | null = null;
    let foundOffset = 0;
    
    while ((node = nodeStack.pop())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const textLen = node.textContent?.length || 0;
        if (currentPos + textLen >= pos) {
          foundNode = node;
          foundOffset = pos - currentPos;
          break;
        }
        currentPos += textLen;
      } else {
        const children = node.childNodes;
        for (let i = children.length - 1; i >= 0; i--) {
          nodeStack.push(children[i]);
        }
      }
    }
    
    if (foundNode) {
      const range = document.createRange();
      range.setStart(foundNode, foundOffset);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const getPlainText = () => {
    return editorRef.current?.innerText || "";
  };

  const renderFormattedContent = useCallback((text: string) => {
    const mentionRegex = /(@[\w-]+(?:\s+[\w-]+)?)/g;
    const parts = text.split(mentionRegex);
    
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return `<span class="text-green-600 dark:text-green-400 font-medium" data-mention="true">${part}</span>`;
      }
      return part.replace(/\n/g, '<br>');
    }).join('');
  }, []);

  const updateContent = useCallback((newText: string, caretPos?: number) => {
    if (!editorRef.current) return;
    
    const formattedHtml = renderFormattedContent(newText);
    editorRef.current.innerHTML = formattedHtml || '<br>';
    
    if (caretPos !== undefined) {
      setTimeout(() => setCaretPosition(caretPos), 0);
    }
  }, [renderFormattedContent]);

  useEffect(() => {
    if (editorRef.current && value !== getPlainText()) {
      updateContent(value, value.length);
    }
  }, [value, updateContent]);

  const handleSelectUser = (user: SafeUser) => {
    if (mentionStartPos === null) return;
    
    const displayName = getUserDisplayName(user);
    const currentText = getPlainText();
    const caretPos = getCaretPosition();
    
    const before = currentText.slice(0, mentionStartPos);
    const after = currentText.slice(caretPos);
    const newText = before + "@" + displayName + " " + after;
    const newCaretPos = mentionStartPos + displayName.length + 2;
    
    onChange(newText);
    
    if (!mentionedUserIds.includes(user.id)) {
      onMentionAdd(user.id);
    }
    
    setShowMentionDropdown(false);
    setMentionStartPos(null);
    setSelectedIndex(0);
    
    setTimeout(() => {
      updateContent(newText, newCaretPos);
      editorRef.current?.focus();
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !showMentionDropdown) {
      e.preventDefault();
      // Check both prop value and current editor content (in case prop hasn't synced yet)
      const currentContent = getPlainText().trim();
      if (onSubmit && (value.trim() || currentContent || attachments.length > 0 || stagedFiles.length > 0)) {
        // Sync the content before submitting
        if (currentContent && !value.trim()) {
          onChange(currentContent);
        }
        onSubmit();
      }
      return;
    }

    if (!showMentionDropdown || filteredUsers.length === 0) {
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => 
          prev < filteredUsers.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;
      case "Enter":
        e.preventDefault();
        if (filteredUsers[selectedIndex]) {
          handleSelectUser(filteredUsers[selectedIndex]);
        }
        break;
      case "Escape":
        setShowMentionDropdown(false);
        setMentionStartPos(null);
        break;
      case "Tab":
        e.preventDefault();
        if (filteredUsers[selectedIndex]) {
          handleSelectUser(filteredUsers[selectedIndex]);
        }
        break;
    }
  };

  const handleInput = () => {
    const newText = getPlainText();
    const caretPos = getCaretPosition();
    
    onChange(newText);

    const textBeforeCursor = newText.slice(0, caretPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      const hasNewline = textAfterAt.includes("\n");
      const isStartOfWord = lastAtIndex === 0 || /[\s\n]/.test(newText[lastAtIndex - 1]);
      
      if (!hasNewline && isStartOfWord && textAfterAt.length < 20) {
        setMentionSearch(textAfterAt.toLowerCase());
        setMentionStartPos(lastAtIndex);
        setShowMentionDropdown(true);
        return;
      }
    }
    
    setShowMentionDropdown(false);
    setMentionStartPos(null);
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (!showMentionDropdown) {
        setIsFocused(false);
      }
    }, 150);
    
    const currentText = getPlainText();
    if (currentText !== value) {
      updateContent(currentText, getCaretPosition());
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const getFileIcon = (filetype: string) => {
    if (filetype.startsWith("image/")) return <ImageIcon className="w-4 h-4" />;
    if (filetype.startsWith("video/")) return <Video className="w-4 h-4" />;
    if (filetype.startsWith("audio/")) return <Music className="w-4 h-4" />;
    if (filetype.includes("pdf") || filetype.includes("document") || filetype.includes("word")) {
      return <FileText className="w-4 h-4" />;
    }
    return <File className="w-4 h-4" />;
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const newStagedFiles: StagedFile[] = Array.from(files).map(file => ({
      file,
      id: Math.random().toString(36).substring(7),
      uploading: false,
      progress: 0,
    }));
    
    setStagedFiles(prev => [...prev, ...newStagedFiles]);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setIsUploading(true);
    const uploadedAttachments: NoteAttachment[] = [];
    
    for (const stagedFile of newStagedFiles) {
      try {
        setStagedFiles(prev => prev.map(f => 
          f.id === stagedFile.id ? { ...f, uploading: true } : f
        ));
        
        const uploadUrlRes = await fetch("/api/objects/upload", {
          method: "POST",
          credentials: "include",
        });
        if (!uploadUrlRes.ok) throw new Error("Failed to get upload URL");
        const { uploadURL, objectPath } = await uploadUrlRes.json();
        
        const uploadRes = await fetch(uploadURL, {
          method: "PUT",
          body: stagedFile.file,
          headers: { "Content-Type": stagedFile.file.type || "application/octet-stream" },
        });
        if (!uploadRes.ok) throw new Error("Failed to upload file");
        
        const fileUrl = objectPath;
        
        uploadedAttachments.push({
          url: fileUrl,
          filename: stagedFile.file.name,
          filesize: stagedFile.file.size,
          filetype: stagedFile.file.type || "application/octet-stream",
        });
        
        setStagedFiles(prev => prev.filter(f => f.id !== stagedFile.id));
      } catch (error) {
        console.error("Error uploading file:", error);
        setStagedFiles(prev => prev.map(f => 
          f.id === stagedFile.id ? { ...f, uploading: false, error: "Upload failed" } : f
        ));
      }
    }
    
    setIsUploading(false);
    
    if (uploadedAttachments.length > 0 && onAttachmentsChange) {
      onAttachmentsChange([...attachments, ...uploadedAttachments]);
    }
  };

  const removeAttachment = (index: number) => {
    if (onAttachmentsChange) {
      onAttachmentsChange(attachments.filter((_, i) => i !== index));
    }
  };

  const removeStagedFile = (id: string) => {
    setStagedFiles(prev => prev.filter(f => f.id !== id));
  };

  return (
    <div className="relative">
      {(attachments.length > 0 || stagedFiles.length > 0) && (
        <div className="flex flex-wrap gap-2 mb-2 p-2 bg-muted/50 rounded-md">
          {attachments.map((attachment, index) => (
            <div 
              key={`attachment-${index}`}
              className="flex items-center gap-2 bg-background border rounded-md px-2 py-1 text-sm"
              data-testid={`attachment-${index}`}
            >
              {getFileIcon(attachment.filetype)}
              <span className="max-w-[120px] truncate">{attachment.filename}</span>
              <span className="text-xs text-muted-foreground">({formatFileSize(attachment.filesize)})</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5"
                onClick={() => removeAttachment(index)}
                data-testid={`button-remove-attachment-${index}`}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
          {stagedFiles.map((stagedFile) => (
            <div 
              key={stagedFile.id}
              className={`flex items-center gap-2 border rounded-md px-2 py-1 text-sm ${
                stagedFile.error ? 'bg-destructive/10 border-destructive' : 'bg-background'
              }`}
            >
              {getFileIcon(stagedFile.file.type)}
              <span className="max-w-[120px] truncate">{stagedFile.file.name}</span>
              {stagedFile.uploading && (
                <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              )}
              {stagedFile.error && (
                <span className="text-xs text-destructive">{stagedFile.error}</span>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5"
                onClick={() => removeStagedFile(stagedFile.id)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
      
      <div className="flex gap-2 items-end">
        <div className="flex-1 relative">
          <div
            ref={editorRef}
            contentEditable
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={handleBlur}
            data-placeholder={placeholder}
            className={`min-h-[40px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background 
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
              disabled:cursor-not-allowed disabled:opacity-50 overflow-auto whitespace-pre-wrap
              empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground
              transition-all duration-200 ${
                isFocused || value ? "min-h-[80px]" : "min-h-[40px]"
              } ${className}`}
            data-testid={testId}
            suppressContentEditableWarning
          />
          
          {showMentionDropdown && filteredUsers.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute left-0 bottom-full mb-1 z-50 w-[240px] rounded-md border bg-popover shadow-md"
            >
              <ScrollArea className="max-h-[200px]">
                <div className="p-1">
                  {filteredUsers.map((user, index) => (
                    <div
                      key={user.id}
                      ref={(el) => (itemRefs.current[index] = el)}
                      onClick={() => handleSelectUser(user)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`flex flex-col cursor-pointer rounded-sm px-2 py-1.5 text-sm ${
                        index === selectedIndex
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent hover:text-accent-foreground"
                      }`}
                      data-testid={`mention-option-${user.id}`}
                    >
                      <span>{getUserDisplayName(user)}</span>
                      {user.email && (
                        <span className="text-xs text-muted-foreground">{user.email}</span>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
        
        {showAttachButton && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
              data-testid="input-file-attachment"
            />
            <Button
              size="icon"
              variant="ghost"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-10 w-10 flex-shrink-0 rounded-full"
              disabled={isUploading}
              data-testid="button-attach-file"
            >
              {isUploading ? (
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              ) : (
                <Paperclip className="w-5 h-5" />
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
