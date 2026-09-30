/**
 * A Project's pages as the page tree draws them — v1's Document page, and the
 * v2 Project Dossier's Documentation tab since #307: each page under its
 * parent, siblings by position. A page whose parent is gone stays reachable
 * at the top level.
 */

export type PageTreeNode<T> = T & { children: PageTreeNode<T>[] };

type TreePage = { id: string; parentId: string | null; position: number };

export function buildPageTree<T extends TreePage>(pages: T[]): PageTreeNode<T>[] {
  const nodes = new Map<string, PageTreeNode<T>>();
  for (const page of pages) nodes.set(page.id, { ...page, children: [] });

  const roots: PageTreeNode<T>[] = [];
  for (const page of pages) {
    const parent = page.parentId ? nodes.get(page.parentId) : undefined;
    (parent ? parent.children : roots).push(nodes.get(page.id)!);
  }

  const sortSiblings = (siblings: PageTreeNode<T>[]) => {
    siblings.sort((a, b) => a.position - b.position);
    siblings.forEach((node) => sortSiblings(node.children));
  };
  sortSiblings(roots);
  return roots;
}

/** The pages above one, top first: what the tree opens so that page shows. */
export function pageAncestorIds(pages: Array<{ id: string; parentId: string | null }>, id: string): string[] {
  const parentOf = new Map(pages.map((page) => [page.id, page.parentId]));
  const ancestors: string[] = [];
  const seen = new Set([id]);
  let parent = parentOf.get(id) ?? null;
  while (parent && parentOf.has(parent) && !seen.has(parent)) {
    ancestors.unshift(parent);
    seen.add(parent);
    parent = parentOf.get(parent) ?? null;
  }
  return ancestors;
}
