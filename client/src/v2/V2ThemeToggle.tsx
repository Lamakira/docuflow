import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { composeAccountMenu, type AccountTheme } from "./chrome";

const THEME_ICON: Record<AccountTheme, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

/**
 * The theme row of an account menu (#314): Light, Dark and System as a
 * segmented toggle. Shared by the Workspace rail and the platform console. The
 * segments stay menu radio items, so arrow keys reach them, and picking one
 * keeps the menu open so the change shows at once.
 */
export function V2ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { themeOptions } = composeAccountMenu({ theme });

  return (
    <div className="df-theme-row">
      <span className="df-theme-label">Theme</span>
      <DropdownMenuRadioGroup
        className="df-theme-toggle"
        value={themeOptions.find((option) => option.selected)?.id ?? "light"}
      >
        {themeOptions.map((option) => {
          const Icon = THEME_ICON[option.id];
          return (
            <DropdownMenuRadioItem
              key={option.id}
              value={option.id}
              className="df-theme-toggle-item"
              aria-label={option.label}
              title={option.label}
              data-testid={`v2-theme-${option.id}`}
              // A prevented select keeps the menu open, and also skips Radix's
              // own value change, so the theme is set here.
              onSelect={(event) => {
                event.preventDefault();
                setTheme(option.id);
              }}
            >
              <Icon width={15} height={15} strokeWidth={1.5} aria-hidden />
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </div>
  );
}
