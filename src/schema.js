// Budget — structure de la base de données.
// Les tables sont créées automatiquement au premier appel : rien à faire à la main.
// Pour une évolution future, ajouter une étape à EVOLUTIONS (elle s'exécutera une seule fois).

import { CATEGORIES, REGLES, REGLES_V3, REGLES_V4, RESTAURATION, PROJETS } from './defauts.js';

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

// Chaque évolution : [numéro de version, fonction qui renvoie les instructions SQL (préparées)].
const EVOLUTIONS = [
  // 2 : catégories, règles, projets, type de compte (courant, carte, épargne).
  [2, (db) => [
    db.prepare(`CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY, nom TEXT NOT NULL, type TEXT NOT NULL, budget INTEGER NOT NULL DEFAULT 0, ordre INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS regles (
      id TEXT PRIMARY KEY, motif TEXT NOT NULL, categorie TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'perso', cree TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS projets (
      id TEXT PRIMARY KEY, nom TEXT NOT NULL, budget INTEGER NOT NULL DEFAULT 0, debut TEXT NOT NULL, fin TEXT NOT NULL,
      motif TEXT, archive INTEGER NOT NULL DEFAULT 0, cree TEXT NOT NULL)`),
    // categorie : choix manuel (vide = classement automatique par les règles).
    // projet : NULL = aucun, '' = retiré à la main d'un projet (ne plus le rattacher).
    db.prepare('ALTER TABLE operations ADD COLUMN categorie TEXT'),
    db.prepare('ALTER TABLE operations ADD COLUMN projet TEXT'),
    db.prepare('CREATE INDEX IF NOT EXISTS operations_projet ON operations (projet)'),
    db.prepare("ALTER TABLE comptes ADD COLUMN type TEXT NOT NULL DEFAULT 'courant'"),
    db.prepare('ALTER TABLE comptes ADD COLUMN jour_debit INTEGER'),
    ...CATEGORIES.map(([id, nom, type, budget], i) =>
      db.prepare('INSERT OR IGNORE INTO categories (id, nom, type, budget, ordre) VALUES (?, ?, ?, ?, ?)').bind(id, nom, type, budget, i)),
    ...Object.entries(REGLES).flatMap(([cat, motifs]) => motifs.map((m) =>
      db.prepare("INSERT OR IGNORE INTO regles (id, motif, categorie, source, cree) VALUES (?, ?, ?, 'defaut', ?)").bind(`d:${m}`, m, cat, new Date().toISOString()))),
    ...PROJETS.map(([id, nom, budget, debut, fin, motif]) =>
      db.prepare('INSERT OR IGNORE INTO projets (id, nom, budget, debut, fin, motif, cree) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, nom, budget, debut, fin, motif, new Date().toISOString())),
  ]],
  // 3 : numéro de carte (débit différé) et règles complémentaires. Les comptes sont réimportés
  //     une fois pour nettoyer les libellés déjà enregistrés (les classements manuels sont conservés).
  [3, (db) => [
    db.prepare('ALTER TABLE operations ADD COLUMN carte TEXT'),
    db.prepare('UPDATE comptes SET synchro = NULL'),
    ...Object.entries(REGLES_V3).flatMap(([cat, motifs]) => motifs.map((m) =>
      db.prepare("INSERT OR IGNORE INTO regles (id, motif, categorie, source, cree) SELECT ?, ?, ?, 'defaut', ? WHERE EXISTS (SELECT 1 FROM categories WHERE id = ?)")
        .bind(`d:${m}`, m, cat, new Date().toISOString(), cat))),
  ]],
  // 4 : date d'achat des paiements carte (« FACT jjmmaa ») et nouvelles règles : réimport unique.
  [4, (db) => [
    db.prepare('UPDATE comptes SET synchro = NULL'),
    ...Object.entries(REGLES_V4).flatMap(([cat, motifs]) => motifs.map((m) =>
      db.prepare("INSERT OR IGNORE INTO regles (id, motif, categorie, source, cree) SELECT ?, ?, ?, 'defaut', ? WHERE EXISTS (SELECT 1 FROM categories WHERE id = ?)")
        .bind(`d:${m}`, m, cat, new Date().toISOString(), cat))),
  ]],
  // 5 : commentaires (sur une opération, ou ajoutés automatiquement par une règle).
  [5, (db) => [
    db.prepare('ALTER TABLE operations ADD COLUMN note TEXT'),
    db.prepare('ALTER TABLE regles ADD COLUMN note TEXT'),
  ]],
  // 6 : restaurants et sorties dans Shopping (règles de départ seulement ; tes règles ne bougent pas).
  [6, (db) => [
    db.prepare(`UPDATE regles SET categorie = 'shopping'
      WHERE source = 'defaut' AND categorie = 'loisirs' AND motif IN (SELECT value FROM json_each(?))
        AND EXISTS (SELECT 1 FROM categories WHERE id = 'shopping')`).bind(JSON.stringify(RESTAURATION)),
  ]],
];

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
        ...instructions(env.DB),
        env.DB.prepare("INSERT INTO reglages (cle, valeur) VALUES ('version', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").bind(String(v)),
      ]);
      version = v;
    }
  })().catch((e) => { pret = null; throw e; });
  return pret;
}
