/**
 * The action plan's category list, as the form needs it.
 *
 * The rows arrive already ordered from the database (sortOrder, then label);
 * all this does is fold runs of the same heading into the groups the select
 * renders as optgroups. Pure, so the folding can be tested without a
 * database or a browser.
 */
export interface PlanCategory {
  id: string;
  label: string;
  /** The optgroup heading. Empty for a row that belongs under no heading. */
  groupLabel: string;
}

/**
 * Consecutive rows sharing a heading, in the order they were given.
 *
 * Runs rather than a map on purpose: the order is the database's to decide
 * through sortOrder, and grouping by key would quietly re-order the list
 * into whatever the map's insertion order happened to be. A heading that
 * appears twice with other headings between stays as two runs, which is
 * what the rows literally say.
 *
 * An empty heading comes back as its own run so the caller can render those
 * options loose rather than under a blank optgroup — a category added
 * without a group should still be selectable.
 */
export function groupCategories(categories: readonly PlanCategory[]): Array<[string, PlanCategory[]]> {
  const groups: Array<[string, PlanCategory[]]> = [];
  for (const category of categories) {
    const last = groups.at(-1);
    if (last && last[0] === category.groupLabel) last[1].push(category);
    else groups.push([category.groupLabel, [category]]);
  }
  return groups;
}
