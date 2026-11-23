// Budget — structure de la base de données.
// Les tables sont créées automatiquement au premier appel : rien à faire à la main.
// Pour une évolution future, ajouter une étape à EVOLUTIONS (elle s'exécutera une seule fois).

const TABLES = [
  `CREATE TABLE IF NOT EXISTS appareils ( id TEXT PRIMARY KEY, nom TEXT NOT NULL, jeton TEXT NOT NULL UNIQUE, admin INTEGER NOT NULL DEFAULT 0, cree TEXT NOT NULL, vu TEXT NOT NULL )`,
  `CREATE TABLE IF NOT EXISTS invitations ( code TEXT PRIMARY KEY, nom TEXT NOT NULL, expire TEXT NOT NULL, restant INTEGER NOT NULL )`,
  `CREATE TABLE IF NOT EXISTS connexions ( id TEXT PRIMARY KEY, banque TEXT NOT NULL, pays TEXT NOT NULL, expire TEXT, cree TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'active', erreur TEXT )`,
  `CREATE TABLE IF NOT EXISTS comptes ( id TEXT PRIMARY KEY, uid TEXT NOT NULL, connexion TEXT NOT NULL, nom TEXT NOT NULL, iban TEXT, devise TEXT NOT NULL DEFAULT 'EUR', solde INTEGER, solde_type TEXT, solde_date TEXT, synchro TEXT, masque INTEGER NOT NULL DEFAULT 0 )`,
  `CREATE TABLE IF NOT EXISTS operations ( id TEXT PRIMARY KEY, compte TEXT NOT NULL, date TEXT NOT NULL, montant INTEGER NOT NULL, libelle TEXT NOT NULL, contrepartie TEXT, statut TEXT NOT NULL, brut TEXT, vu TEXT NOT NULL )`,
  `CREATE INDEX IF NOT EXISTS operations_date ON operations (date)`,
  `CREATE INDEX IF NOT EXISTS operations_compte ON operations (compte, date)`,
  `CREATE TABLE IF NOT EXISTS reglages ( cle TEXT PRIMARY KEY, valeur TEXT NOT NULL )`,
];

// Exemple : [2, ['ALTER TABLE operations ADD COLUMN categorie TEXT']]
const EVOLUTIONS = [];

let pret = null;

export function preparerBase(env) {
  pret ??= (async () => {
    await env.DB.batch(TABLES.map((s) => env.DB.prepare(s)));
    if (!EVOLUTIONS.length) return;
    const r = await env.DB.prepare("SELECT valeur FROM reglages WHERE cle = 'version'").first();
    let version = r ? Number(JSON.parse(r.valeur)) : 1;
    for (const [v, instructions] of EVOLUTIONS) {
      if (v <= version) continue;
      await env.DB.batch([
        ...instructions.map((s) => env.DB.prepare(s)),
        env.DB.prepare("INSERT INTO reglages (cle, valeur) VALUES ('version', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").bind(String(v)),
      ]);
      version = v;
    }
  })().catch((e) => { pret = null; throw e; });
  return pret;
}
