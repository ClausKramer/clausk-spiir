using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data;

// Seeds default Danish merchant categories and rules for a newly registered user.
public class DefaultDataSeeder(AppDbContext db)
{
    private static readonly (string Name, string Emoji, (string Pattern, bool IsRegex, int Priority)[] Rules)[] Defaults =
    [
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
            (@"circle\s*k|q8|shell|esso|ok\s*benzin", true, 10),
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
        ("Bank & Gebyrer", "🏦", [
            (@"gebyr|overf[øo]rsel|rente", true, 10),
        ]),
        ("Rejser", "✈️", [
            (@"norwegian|sas\b|easyjet|ryanair", true, 10),
            (@"airbnb|booking\.com|hotels\.com", true, 10),
        ]),
        ("Bolig", "🏠", [
            (@"husleje|ejendom|andelsbolig", true, 10),
        ]),
        ("Andet", "📌", []),
    ];

    public async Task SeedForUserAsync(User user, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var categories = new List<Category>();

        foreach (var (name, emoji, _) in Defaults)
        {
            categories.Add(new Category
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Name = name,
                Emoji = emoji,
                CreatedAt = now,
            });
        }

        db.Categories.AddRange(categories);

        var rules = new List<CategorizationRule>();
        for (var i = 0; i < Defaults.Length; i++)
        {
            var (_, _, rulesDefs) = Defaults[i];
            var category = categories[i];
            foreach (var (pattern, isRegex, priority) in rulesDefs)
            {
                rules.Add(new CategorizationRule
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Id,
                    Pattern = pattern,
                    IsRegex = isRegex,
                    CategoryId = category.Id,
                    Priority = priority,
                    CreatedAt = now,
                });
            }
        }

        db.CategorizationRules.AddRange(rules);
        await db.SaveChangesAsync(ct);
    }
}
