using Spiir.Api.Data.Repositories;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data;

// Seeds and maintains the default chart of accounts (see DefaultCategoryTree) for a user.
public class DefaultDataSeeder(CategoryRepository categories, CategorizationRuleRepository categorizationRules)
{
    // Kept in sync with TransactionEndpoints.LearnedRulePriority — the boundary between rules this
    // seeder owns and rules the user's corrections created, which it must never touch.
    private const int LearnedRulePriority = 100;

    public Task SeedForUserAsync(User user, CancellationToken ct = default) =>
        SeedMissingForUserAsync(user.Id, ct);

    /// <summary>
    /// Converges the user's categories and seeded rules onto the current defaults: renames legacy
    /// flat categories onto their place in the tree, adds missing groups and leaves, links leaves
    /// to their group, and removes seeded rules that are no longer declared. Categories are never
    /// deleted — they may have transactions attached — and rules learned from the user's own
    /// corrections are left alone. Safe to re-run; registration and backfilling share this path.
    /// </summary>
    public async Task<(int Categories, int Rules, int Removed)> SeedMissingForUserAsync(
        Guid userId, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var existing = (await categories.GetAllForUserAsync(userId, ct)).ToList();

        // Renaming first, so a legacy category is matched by its new name below and reused rather
        // than duplicated. Only renames onto a name nothing else already holds.
        var byName = existing.ToDictionary(c => c.Name, StringComparer.OrdinalIgnoreCase);
        foreach (var (legacyName, newName) in DefaultCategoryTree.LegacyRenames)
        {
            if (string.Equals(legacyName, newName, StringComparison.OrdinalIgnoreCase)) continue;
            if (!byName.TryGetValue(legacyName, out var legacy)) continue;
            if (byName.ContainsKey(newName)) continue;

            await categories.RenameAsync(userId, legacy.Id, newName, ct);
            legacy.Name = newName;
            byName.Remove(legacyName);
            byName[newName] = legacy;
        }

        var added = new List<Category>();

        Category Ensure(string name, string emoji, Guid? parentId, string kind)
        {
            if (byName.TryGetValue(name, out var found)) return found;

            var created = new Category
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Name = name,
                Emoji = emoji,
                ParentCategoryId = parentId,
                Kind = kind,
                CreatedAt = now,
            };
            added.Add(created);
            byName[name] = created;
            return created;
        }

        // Groups first: a leaf needs its parent's id before it can be linked to it.
        var leafParent = new Dictionary<Guid, (Guid ParentId, string Kind)>();
        foreach (var group in DefaultCategoryTree.Groups)
        {
            var parent = Ensure(group.Name, group.Emoji, null, group.Kind);
            foreach (var leaf in group.Leaves)
            {
                var category = Ensure(leaf.Name, leaf.Emoji, parent.Id, group.Kind);
                leafParent[category.Id] = (parent.Id, group.Kind);
            }
        }

        if (added.Count > 0) await categories.InsertManyAsync(added, ct);

        // Existing categories keep their id but need their place in the tree set. Also catches
        // anything the user renamed by hand, or a leaf added before its group existed.
        foreach (var category in byName.Values)
        {
            if (!leafParent.TryGetValue(category.Id, out var target)) continue;
            if (category.ParentCategoryId == target.ParentId && category.Kind == target.Kind) continue;

            await categories.SetParentAndKindAsync(userId, category.Id, target.ParentId, target.Kind, ct);
        }

        // Anything left unplaced is a category the user created or one this tree no longer names.
        // Filed under Diverse rather than left loose, so nothing disappears from the breakdown.
        var misc = byName["Diverse"];
        foreach (var orphan in byName.Values)
        {
            var isGroup = DefaultCategoryTree.Groups.Any(g => g.Name.Equals(orphan.Name, StringComparison.OrdinalIgnoreCase));
            if (isGroup || leafParent.ContainsKey(orphan.Id) || orphan.ParentCategoryId is not null) continue;

            await categories.SetParentAndKindAsync(userId, orphan.Id, misc.Id, CategoryKind.Variable, ct);
        }

        var (addedRules, removedRules) = await SyncRulesAsync(userId, byName, now, ct);
        return (added.Count, addedRules, removedRules);
    }

    private async Task<(int Added, int Removed)> SyncRulesAsync(
        Guid userId, Dictionary<string, Category> byName, DateTime now, CancellationToken ct)
    {
        var allRules = await categorizationRules.GetAllForUserOrderedAsync(userId, ct);
        var existingRules = allRules.Select(r => (r.Pattern, r.CategoryId)).ToHashSet();

        var declared = new HashSet<(string, Guid)>();
        var newRules = new List<CategorizationRule>();

        foreach (var group in DefaultCategoryTree.Groups)
        {
            foreach (var leaf in group.Leaves)
            {
                var categoryId = byName[leaf.Name].Id;
                foreach (var (pattern, isRegex, priority) in leaf.Rules)
                {
                    declared.Add((pattern, categoryId));
                    if (!existingRules.Add((pattern, categoryId))) continue;

                    newRules.Add(new CategorizationRule
                    {
                        Id = Guid.NewGuid(),
                        UserId = userId,
                        Pattern = pattern,
                        IsRegex = isRegex,
                        CategoryId = categoryId,
                        Priority = priority,
                        CreatedAt = now,
                    });
                }
            }
        }

        if (newRules.Count > 0) await categorizationRules.InsertManyAsync(newRules, ct);

        // Retract seeded rules that are no longer declared, so a default that turns out to be
        // harmful doesn't live on forever in accounts created before it was removed.
        var stale = allRules
            .Where(r => r.Priority < LearnedRulePriority && !declared.Contains((r.Pattern, r.CategoryId)))
            .Select(r => r.Id)
            .ToList();

        if (stale.Count > 0) await categorizationRules.DeleteByIdsAsync(userId, stale, ct);

        return (newRules.Count, stale.Count);
    }
}
