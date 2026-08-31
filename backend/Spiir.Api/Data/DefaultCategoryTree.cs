using Spiir.Api.Domain.Entities;

namespace Spiir.Api.Data;

public record LeafDef(string Name, string Emoji, (string Pattern, bool IsRegex, int Priority)[] Rules);
public record GroupDef(string Name, string Emoji, string Kind, LeafDef[] Leaves);

/// <summary>
/// The default chart of accounts: top-level groups for reading a budget, leaves for filing a
/// transaction. Modelled on standard Danish household budgeting, where the primary split is
/// faste versus variable udgifter — the one that answers "how much of this can I actually
/// change?". Savings, debt and transfers are separate kinds rather than expense categories,
/// because a month with extra saving isn't a month of overspending.
///
/// Every name is unique across the whole tree, which lets categories be matched by name alone
/// when seeding and re-seeding.
/// </summary>
public static class DefaultCategoryTree
{
    public static readonly GroupDef[] Groups =
    [
        new("Indtægter", "💰", CategoryKind.Income, [
            new("Løn", "💵", [(@"\bl[øo]n\b|lønoverførsel|salary", true, 20)]),
            new("Offentlige ydelser", "🏛️", [(@"\bsu\b|dagpenge|folkepension|b[øo]rnetilskud|boligst[øo]tte", true, 15)]),
            new("Renter & udbytte", "📈", [(@"renteindt[æa]gt|udbytte", true, 15)]),
            new("Refusion & tilbagebetaling", "↩️", [(@"refusion|tilbagebetaling|udl[æa]g retur", true, 15)]),
        ]),

        new("Bolig", "🏠", CategoryKind.Fixed, [
            new("Husleje & boligafgift", "🔑", [(@"husleje|boligafgift|leje\b", true, 15)]),
            new("Realkredit & boliglån", "🏦", [(@"realkredit|totalkredit|nykredit|boligl[åa]n", true, 15)]),
            new("El, vand & varme", "💡", [(@"\baura\b|ewii|norlys|andel energi|[øo]rsted|fjernvarme|vandv[æa]rk|hofor", true, 12)]),
            new("Ejendomsskat & fællesudgifter", "🧾", [(@"ejendomsskat|grundskyld|f[æa]llesudg|grundejer|e/f\b|a/b\b", true, 12)]),
            new("Vedligehold & indretning", "🔧", [(@"bauhaus|silvan|jem\s*&\s*fix|st[åa]lgruppen|ilva|jysk", true, 10)]),
        ]),

        new("Transport", "🚗", CategoryKind.Variable, [
            new("Billån & leasing", "🚙", [(@"santander|bill[åa]n|leasing", true, 15)]),
            new("Brændstof & opladning", "⛽", [(@"circle\s*k|circlek|q8|shell|esso|ok\s*benzin|uno-?x|clever|spirii", true, 12)]),
            new("Bilforsikring & ejerafgift", "🛡️", [(@"ejerafgift|gr[øo]n ejerafgift|bilforsikring", true, 12)]),
            new("Service & reparation", "🔩", [(@"autov[æa]rksted|d[æa]kcenter|bilsyn|synshal", true, 10)]),
            new("Offentlig transport", "🚂", [(@"\bdsb\b|rejsekort|movia|metro|arriva|flixbus", true, 12)]),
            new("Parkering & broafgift", "🅿️", [(@"parkering|easypark|apcoa|storeb[æa]lt|[øo]resundsbro", true, 12)]),
        ]),

        new("Dagligvarer & husholdning", "🛒", CategoryKind.Variable, [
            new("Dagligvarer", "🥕", [
                (@"netto", false, 10),
                (@"rema\s*1000|rema1000", true, 10),
                (@"aldi", false, 10),
                (@"lidl", false, 10),
                (@"bilka", false, 10),
                (@"f[øo]tex|foetex", true, 10),
                (@"brugsen|superbrugsen|dagli'brugsen", true, 10),
                (@"meny", false, 10),
                (@"\bspar\b", true, 10),
                (@"\bcoop\b|kvickly|fakta|irma", true, 10),
            ]),
            new("Personlig pleje", "🧴", [(@"matas|normal\b|frisør|saloon", true, 10)]),
            new("Husholdning & rengøring", "🧽", [(@"reng[øo]ring|vaskeri", true, 10)]),
            new("Kæledyr", "🐾", [(@"dyrl[æa]ge|zooligisk|petworld|kæledyr", true, 10)]),
        ]),

        new("Sundhed", "🩺", CategoryKind.Fixed, [
            new("Forsikringer", "🛡️", [(@"tryg|alka|codan|topdanmark|privatsikring|sygeforsikringen danmark", true, 12)]),
            new("Læge & tandlæge", "🦷", [(@"tandl[æa]ge|l[æa]gehus|fysioterapi|kiropraktor", true, 10)]),
            new("Apotek & medicin", "💊", [(@"apotek", false, 10)]),
        ]),

        new("Abonnementer", "📱", CategoryKind.Fixed, [
            new("Mobil & internet", "📶", [(@"telmore|yousee|telenor|telia|3danmark|hiper|fastspeed|cbb", true, 12)]),
            new("Streaming & medier", "📺", [(@"netflix|spotify|hbo|viaplay|disney|mofibo|storytel|podimo|dr licens", true, 12)]),
            new("Software & apps", "💻", [(@"apple\.com/bill|google\s*\*|microsoft|adobe|openai|github|dropbox", true, 12)]),
            new("Fagforening & A-kasse", "🤝", [(@"a-kasse|akasse|fagforening|ledernes|hk\b|3f\b|krifa", true, 12)]),
            new("Foreninger & kontingent", "🎟️", [(@"kontingent|forening", true, 10)]),
        ]),

        new("Fritid", "🎭", CategoryKind.Variable, [
            new("Restaurant & takeaway", "🍔", [
                (@"mcdonald|mcdonalds|mc donald|mcd", true, 10),
                (@"burger\s*king|sunset boulevard|jensens", true, 10),
                (@"just\s*eat|wolt|hungry|pizza|sushi|grill", true, 10),
            ]),
            new("Café & bar", "☕", [(@"starbucks|baresso|joe.*juice|caf[eé]\b|espresso house|bodega", true, 10)]),
            new("Sport & fitness", "🏋️", [(@"fitness\s*world|sats\b|crossfit|padel|matchi|badminton|svømmehal", true, 10)]),
            new("Kultur & events", "🎫", [(@"biograf|nordisk film|kino|teater|billetlugen|ticketmaster|smukfest|roskilde festival", true, 10)]),
            new("Hobby", "🎨", [(@"hobby|panduro|garn|modelbutik", true, 10)]),
            new("Ferie & rejser", "✈️", [
                (@"norwegian|\bsas\b|easyjet|ryanair", true, 10),
                (@"airbnb|booking\.com|hotels\.com|landal|feriepartner|bornholmslinjen|molslinjen|camping", true, 10),
            ]),
        ]),

        new("Shopping", "🛍️", CategoryKind.Variable, [
            new("Tøj & sko", "👕", [(@"h&m|h\s*&\s*m|hennes|zara|vero\s*moda|jack.*jones|zalando|deichmann|magasin", true, 10)]),
            new("Elektronik", "🔌", [(@"elgiganten|\bpower\b|computersalg|proshop", true, 10)]),
            new("Nethandel", "📦", [(@"amazon|coolshop|wish|temu|ebay", true, 10)]),
            new("Gaver", "🎁", [(@"gave\b|gavekort", true, 10)]),
        ]),

        new("Familie", "🧸", CategoryKind.Variable, [
            new("Daginstitution & SFO", "🏫", [(@"daginstitution|vuggestue|b[øo]rnehave|\bsfo\b|klubtilbud", true, 12)]),
            new("Lommepenge", "🪙", [(@"lommepenge", true, 12)]),
            new("Børnetøj & udstyr", "🧦", [(@"b[øo]rnet[øo]j|babysam", true, 10)]),
            new("Aktiviteter & fritid (børn)", "⚽", [(@"spejder|musikskole|sportsklub", true, 10)]),
        ]),

        new("Uddannelse", "🎓", CategoryKind.Variable, [
            new("Kurser & studieafgift", "📚", [(@"kursus|studieafgift|undervisning|efteruddannelse", true, 10)]),
            new("Bøger & materialer", "📖", [(@"saxo\.com|bogh|l[æa]rebog|studiemateriale", true, 10)]),
        ]),

        new("Opsparing", "🐷", CategoryKind.Savings, [
            new("Bufferopsparing", "🏖️", [(@"opsparing|buffer", true, 12)]),
            new("Pension", "👵", [(@"pensionsindbetaling|velliv|pfa\b|danica|ap pension", true, 12)]),
            new("Investering", "📊", [(@"\bjune\b|nordnet|saxo bank|aktier|investering", true, 12)]),
            new("Børneopsparing", "🎒", [(@"b[øo]rneopsparing", true, 12)]),
        ]),

        new("Gæld", "🏛️", CategoryKind.Debt, [
            new("Forbrugslån", "💳", [(@"forbrugsl[åa]n|l[åa]neydelse|afdrag", true, 12)]),
            new("Kreditkort", "💠", [(@"kreditkort|resurs|ikano", true, 12)]),
            new("Studiegæld", "🎓", [(@"su-?l[åa]n|studiegæld|udbetaling danmark", true, 12)]),
        ]),

        new("Bank & skat", "🧾", CategoryKind.Fixed, [
            new("Gebyrer", "💳", [(@"gebyr|kortgebyr|valutatill[æa]g|kontogebyr", true, 12)]),
            new("Renter", "📉", [(@"renteudgift|overtr[æa]ksrente|debetrente", true, 12)]),
            new("Skat & afgifter", "🏛️", [(@"skattestyrelsen|restskat|b-skat|licens|medieafgift", true, 12)]),
        ]),

        new("Diverse", "📌", CategoryKind.Variable, [
            new("Kontanter", "💵", [(@"kontant|h[æa]vning|\batm\b|automat", true, 10)]),
            new("Donationer", "❤️", [(@"b[øo]rnefonden|r[øo]de kors|unicef|donation|indsamling|plan\b", true, 10)]),
            new("Andet", "❓", []),
        ]),

        new("Overførsler", "🔁", CategoryKind.Transfer, [
            new("Intern overførsel", "↔️", [(@"overf[øo]rsel|overf[øo]rt|ovf\.|egen konto|til budget|fra budget", true, 20)]),
            new("Udlæg & mellemregning", "🧮", [(@"udl[æa]g|mellemregning", true, 12)]),
        ]),
    ];

    /// <summary>
    /// Old flat category names mapped onto their leaf in the tree. Renaming a category keeps its
    /// id, so every transaction and rule already filed under it follows automatically — the
    /// alternative, creating new categories and moving transactions across, would risk stranding
    /// anything the mapping missed. Names not listed here are left alone as extra leaves under
    /// Diverse, so nothing is ever silently dropped.
    /// </summary>
    public static readonly (string LegacyName, string NewName)[] LegacyRenames =
    [
        ("Indkomst", "Løn"),
        ("Overførsel", "Intern overførsel"),
        ("Opsparing & Investering", "Investering"),
        ("Lån & Afdrag", "Forbrugslån"),
        ("Bolig", "Husleje & boligafgift"),
        ("El, Vand & Varme", "El, vand & varme"),
        ("Telefon & Internet", "Mobil & internet"),
        ("Børn & Familie", "Lommepenge"),
        ("Underholdning & Fritid", "Kultur & events"),
        ("Skat & Afgifter", "Skat & afgifter"),
        ("Gaver & Donationer", "Donationer"),
        ("Kontanter", "Kontanter"),
        ("Uddannelse", "Kurser & studieafgift"),
        ("Dagligvarer", "Dagligvarer"),
        ("Transport", "Offentlig transport"),
        ("Restaurant & Café", "Restaurant & takeaway"),
        ("Brændstof", "Brændstof & opladning"),
        ("Apotek & Sundhed", "Apotek & medicin"),
        ("Tøj & Mode", "Tøj & sko"),
        ("Elektronik", "Elektronik"),
        ("Streaming & Abonnementer", "Streaming & medier"),
        ("Forsikring", "Forsikringer"),
        ("Sport & Fitness", "Sport & fitness"),
        ("Nethandel", "Nethandel"),
        ("Bank & Gebyrer", "Gebyrer"),
        ("Rejser", "Ferie & rejser"),
        ("Andet", "Andet"),
    ];
}
