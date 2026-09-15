import { useState } from "react";
import { Link, useLocation } from "wouter";
import { HELP_HUB_ITEMS } from "../content/help-center/helpCenterConfig";
import { HelpSurfaceProvider } from "../components/help-center/helpSurface";
import { HELP_ARTICLE_COMPONENTS } from "../pages/help-center/articleRegistry";
import { composeHelp } from "./help";
import { motionForSurface } from "./motion";
import { matchV2Route } from "./presentation";
import { useV2Chrome } from "./V2Shell";

const ARTICLE_MOTION = motionForSurface("help-article").enterExit;

export function V2HelpPage() {
  const [location] = useLocation();
  const { layout } = useV2Chrome();
  const [query, setQuery] = useState("");
  const match = matchV2Route(location);
  const path = match.kind === "help" && match.slug ? `/help/${match.slug}` : "/help";
  const page = composeHelp({ path, query });

  if (page.kind === "missing") {
    return (
      <div className="df-page" data-testid="v2-help">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Help Center</h1>
            <p className="df-subhead">{page.emptyCopy}</p>
          </div>
        </header>
        <Link href={page.backHref} className="df-ghost-btn">
          Back to Help Center
        </Link>
      </div>
    );
  }

  if (page.kind === "article") {
    const Article = HELP_ARTICLE_COMPONENTS[page.slug];
    return (
      <div className="df-page" data-testid="v2-help">
        <header className="df-today-head">
          <div style={{ minWidth: 0 }}>
            <Link href={page.backHref} className="df-ghost-link">
              Help Center
            </Link>
            <h1 className="df-title">{page.title}</h1>
            {page.subtitle ? <p className="df-subhead">{page.subtitle}</p> : null}
          </div>
        </header>

        {page.toc.length > 0 ? (
          <nav className="df-card df-help-toc" aria-label="On this page">
            <div className="df-card-head">
              <h2 className="df-card-title">On this page</h2>
            </div>
            <ul className="df-help-toc-list">
              {page.toc.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`}>{item.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <article
          key={page.slug}
          className="df-card df-help-article"
          data-motion={ARTICLE_MOTION}
          data-testid="v2-help-article"
        >
          {/* The body renders on v2 tokens, not the discarded v1 system (ADR-0003). */}
          <HelpSurfaceProvider surface="v2">
            <Article />
          </HelpSurfaceProvider>
        </article>
      </div>
    );
  }

  return (
    <div className="df-page" data-testid="v2-help">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Help Center</h1>
          <p className="df-subhead">Articles for DocuFlow — time, projects, the desktop agent, and administration.</p>
        </div>
      </header>

      <label className="df-daily-field">
        Search topics
        <input
          type="search"
          className="df-help-search"
          value={query}
          aria-label="Search Help Center topics"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <section className="df-help-topics" data-testid="v2-help-hub">
        {page.topics.length === 0 ? (
          <p className="df-empty">No Help Center topics match that search.</p>
        ) : (
          page.topics.map((topic) => {
            const icon = HELP_HUB_ITEMS.find((item) => item.slug === topic.slug);
            const Icon = icon?.icon;
            return (
              <Link
                key={topic.slug}
                href={topic.href}
                className="df-card df-help-topic"
                data-testid={`v2-help-topic-${topic.slug}`}
              >
                <span className={layout.stackedRegister ? "df-project-mobile" : "df-help-topic-inner"}>
                  {Icon ? <Icon className="df-help-topic-icon" aria-hidden /> : null}
                  <span style={{ minWidth: 0 }}>
                    <div className="df-row-title">{topic.title}</div>
                    <div className="df-empty" style={{ padding: 0 }}>
                      {topic.subtitle}
                    </div>
                  </span>
                </span>
              </Link>
            );
          })
        )}
      </section>
    </div>
  );
}
