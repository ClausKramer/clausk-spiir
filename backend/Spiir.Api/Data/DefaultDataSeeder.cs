using Spiir.Api.Data.Repositories;
using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data;

// Seeds default Danish merchant categories and rules for a newly registered user.
//
// There's no formal standard for personal-finance categories — the closest thing, MCC
// (ISO 18245, the card-network merchant codes), is far too granular at ~1000 codes. This follows
// the ~20-item top-level set budgeting apps converge on, expressed in Danish and biased toward
// merchants that actually show up on Danish statements.
//
// Income and Transfer matter as much as the spending categories: without them, salary and
// movements between a user's own accounts have nothing valid to map to, so they sit permanently
// uncategorized no matter how good the rules or the LLM fallback are.
public class DefaultDataSeeder(CategoryRepository categories, CategorizationRuleRepository categorizationRules)
{
    private static readonly (string Name, string Emoji, (string Pattern, bool IsRegex, int Priority)[] Rules)[] Defaults =
    [
        ("Indkomst", "💰", [
            (@"\bl[øo]n\b|lønoverførsel|salary", true, 20),
            (@"udbetaling|refusion|tilbagebetaling", true, 10),
            (@"su\b|dagpenge|pension|b[øo]rnepenge|b[øo]rnetilskud", true, 10),
        ]),
        // Deliberately no "mobilepay" rule: MobilePay is a payment rail, not a category — it
        // carries both person-to-person transfers and ordinary purchases ("MobilePay Water &
        // Wellness Randers"). The normalizer strips the prefix so whatever follows gets
        // categorized on its own merits instead.
        ("Overførsel", "🔁", [
            (@"overf[øo]rsel|overf[øo]rt|ovf\.|bs overf", true, 20),
            (@"egen konto|til budget|fra budget|opsparing til", true, 10),
        ]),
        ("Opsparing & Investering", "🐷", [
            (@"june|nordnet|saxo|opsparing", true, 15),
        ]),
        ("Lån & Afdrag", "🏛️", [
            (@"realkredit|totalkredit|santander|billån|afdrag|ydelse", true, 15),
        ]),
        // Name kept as-is (rather than something more descriptive) so backfilling defaults onto an
        // existing account matches the category already there instead of creating a near-duplicate.
        ("Bolig", "🏠", [
            (@"husleje|ejendom|andelsbolig|fællesudg|grundejer", true, 10),
        ]),
        ("El, Vand & Varme", "💡", [
            (@"\baura\b|ewii|norlys|andel energi|ørsted|fjernvarme|vandværk", true, 10),
        ]),
        ("Telefon & Internet", "📱", [
            (@"telmore|yousee|telenor|telia|3danmark|hiper|fastspeed", true, 10),
        ]),
        ("Børn & Familie", "🧸", [
            (@"lommepenge|daginstitution|vuggestue|b[øo]rnehave|sfo\b", true, 10),
        ]),
        ("Underholdning & Fritid", "🎭", [
            (@"matchi|padel|smukfest|roskilde festival|biograf|nordisk film|kino", true, 10),
            (@"mofibo|storytel|audible", true, 10),
        ]),
        ("Skat & Afgifter", "🧾", [
            (@"skattestyrelsen|skat\b|ejerafgift|licens", true, 10),
        ]),
        ("Gaver & Donationer", "🎁", [
            (@"b[øo]rnefonden|r[øo]de kors|unicef|donation|indsamling", true, 10),
        ]),
        ("Kontanter", "💵", [
            (@"kontant|hævning|atm\b|automat", true, 10),
        ]),
        ("Uddannelse", "🎓", [
            (@"studie|kursus|undervisning|lærebog", true, 10),
        ]),
        ("Dagligvarer", "🛒", [
            (@"netto", false, 10),
            (@"rema\s*1000|rema1000", true, 10),
            (@"aldi", false, 10),
            (@"lidl", false, 10),
            (@"bilka", false, 10),
            (@"f[øo]tex|foetex", true, 10),
            (@"irma", false, 10),
            (@"brugsen|superbrugsen|dagli'brugsen", true, 10),
            (@"meny", false, 10),
            (@"\bspar\b", true, 10),
            (@"\bcoop\b|kvickly|fakta", true, 10),
        ]),
        ("Transport", "🚂", [
            (@"dsb", false, 10),
            (@"rejsekort", false, 10),
            (@"flixbus", false, 10),
            (@"uber", false, 10),
            (@"\btaxa\b", true, 10),
        ]),
        ("Restaurant & Café", "🍔", [
            (@"mcdonald|mcdonalds|mc donald", true, 10),
            (@"burger\s*king", true, 10),
            (@"starbucks|baresso|joe.*juice", true, 10),
            (@"just\s*eat|wolt", true, 10),
        ]),
        ("Brændstof", "⛽", [
            (@"circle\s*k|circlek|q8|shell|esso|ok\s*benzin|uno-?x", true, 10),
        ]),
        ("Apotek & Sundhed", "💊", [
            (@"matas", false, 10),
            (@"apotek", false, 10),
        ]),
        ("Tøj & Mode", "👕", [
            (@"h&m|h\s*&\s*m|hennes", true, 10),
            (@"zara", false, 10),
            (@"vero\s*moda|jack.*jones", true, 10),
        ]),
        ("Elektronik", "💻", [
            (@"elgiganten", false, 10),
            (@"\bpower\b", true, 10),
        ]),
        ("Streaming & Abonnementer", "📺", [
            (@"netflix", false, 10),
            (@"spotify", false, 10),
            (@"hbo|viaplay|disney\+|disney plus", true, 10),
        ]),
        ("Forsikring", "🛡️", [
            (@"tryg|alka|codan|topdanmark", true, 10),
        ]),
        ("Sport & Fitness", "🏋️", [
            (@"fitness\s*world|sats\b|crossfit", true, 10),
        ]),
        ("Nethandel", "📦", [
            (@"amazon", false, 10),
            (@"zalando", false, 10),
            (@"coolshop", false, 10),
        ]),
        // Note: no "overførsel" pattern here — that belongs to the Overførsel category above, which
        // matches it at a higher priority. Leaving it here too would make the winner depend on
        // rule ordering rather than intent.
        ("Bank & Gebyrer", "💳", [
            (@"gebyr|rente|kortgebyr|valutatill[æa]g", true, 10),
        ]),
        ("Rejser", "✈️", [
            (@"norwegian|sas\b|easyjet|ryanair", true, 10),
            (@"airbnb|booking\.com|hotels\.com|landal|feriepartner", true, 10),
        ]),
        ("Andet", "📌", []),
    ];

    public Task SeedForUserAsync(User user, CancellationToken ct = default) =>
        SeedMissingForUserAsync(user.Id, ct);

    /// <summary>
    /// Converges the user's categories and seeded rules onto the current defaults: adds what's
    /// missing (categories matched by name, rules by pattern+category) and removes seeded rules
    /// that are no longer declared, so a default that turns out to be wrong can actually be
    /// retracted. Categories are never removed — they may have transactions attached — and rules
    /// learned from the user's own corrections (priority >= LearnedRulePriority) are left alone.
    /// Safe to re-run; registration and backfilling share this one path.
    /// </summary>
    public async Task<(int Categories, int Rules, int Removed)> SeedMissingForUserAsync(Guid userId, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;

        var existing = await categories.GetAllForUserAsync(userId, ct);
        var categoryIdByName = existing.ToDictionary(c => c.Name, c => c.Id, StringComparer.OrdinalIgnoreCase);

        var newCategories = new List<Category>();
        foreach (var (name, emoji, _) in Defaults)
        {
            if (categoryIdByName.ContainsKey(name)) continue;

            var category = new Category
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Name = name,
                Emoji = emoji,
                CreatedAt = now,
            };
            newCategories.Add(category);
            categoryIdByName[name] = category.Id;
        }

        if (newCategories.Count > 0)
            await categories.InsertManyAsync(newCategories, ct);

        var allRules = await categorizationRules.GetAllForUserOrderedAsync(userId, ct);
        var existingRules = allRules.Select(r => (r.Pattern, r.CategoryId)).ToHashSet();

        var declared = new HashSet<(string, Guid)>();
        var newRules = new List<CategorizationRule>();
        foreach (var (name, _, ruleDefs) in Defaults)
        {
            var categoryId = categoryIdByName[name];
            foreach (var (pattern, isRegex, priority) in ruleDefs)
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

        if (newRules.Count > 0)
            await categorizationRules.InsertManyAsync(newRules, ct);

        // Retract seeded rules that are no longer declared. Without this a default that turns out
        // to be harmful (a payment rail matched as if it were a merchant, say) would live on
        // forever in every account created before it was removed.
        var stale = allRules
            .Where(r => r.Priority < LearnedRulePriority && !declared.Contains((r.Pattern, r.CategoryId)))
            .Select(r => r.Id)
            .ToList();

        if (stale.Count > 0)
            await categorizationRules.DeleteByIdsAsync(userId, stale, ct);

        return (newCategories.Count, newRules.Count, stale.Count);
    }

    // Kept in sync with TransactionEndpoints.LearnedRulePriority — the boundary between rules this
    // seeder owns and rules the user's corrections created, which it must never touch.
    private const int LearnedRulePriority = 100;
}
