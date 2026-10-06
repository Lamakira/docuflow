import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/**
 * The signed-in User in an account menu (#316): the photo they set on their
 * account, or their initials while it loads or when they have none.
 */
export function V2UserAvatar({
  imageUrl,
  initials,
  fallbackClassName,
}: {
  imageUrl: string | null | undefined;
  initials: string;
  fallbackClassName: string;
}) {
  return (
    <Avatar className="df-user-avatar" aria-hidden="true">
      {imageUrl ? <AvatarImage src={imageUrl} alt="" /> : null}
      <AvatarFallback className={fallbackClassName}>{initials}</AvatarFallback>
    </Avatar>
  );
}
