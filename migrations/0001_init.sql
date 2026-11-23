-- Téléphones autorisés. Le jeton de session n'est jamais stocké en clair (seulement son empreinte SHA-256).
CREATE TABLE appareils (
  id     TEXT PRIMARY KEY,
  nom    TEXT NOT NULL,
  jeton  TEXT NOT NULL UNIQUE,
  admin  INTEGER NOT NULL DEFAULT 0,
  cree   TEXT NOT NULL,
  vu     TEXT NOT NULL
);

-- Invitations : code à usage limité (3 activations, 48 h).
CREATE TABLE invitations (
  code     TEXT PRIMARY KEY,  -- empreinte SHA-256 du code
  nom      TEXT NOT NULL,
  expire   TEXT NOT NULL,
  restant  INTEGER NOT NULL
);

-- Autorisations données à la banque via Enable Banking (90 à 180 jours).
CREATE TABLE connexions (
  id      TEXT PRIMARY KEY,   -- session_id Enable Banking
  banque  TEXT NOT NULL,
  pays    TEXT NOT NULL,
  expire  TEXT,
  cree    TEXT NOT NULL,
  statut  TEXT NOT NULL DEFAULT 'active',  -- active | expiree | erreur
  erreur  TEXT
);

-- Comptes. id est stable d'une autorisation à l'autre (IBAN ou empreinte fournie par la banque),
-- uid est l'identifiant Enable Banking de l'autorisation en cours.
CREATE TABLE comptes (
  id          TEXT PRIMARY KEY,
  uid         TEXT NOT NULL,
  connexion   TEXT NOT NULL,
  nom         TEXT NOT NULL,
  iban        TEXT,
  devise      TEXT NOT NULL DEFAULT 'EUR',
  solde       INTEGER,          -- en centimes
  solde_type  TEXT,
  solde_date  TEXT,
  synchro     TEXT,
  masque      INTEGER NOT NULL DEFAULT 0
);

-- Opérations. Montants en centimes (négatif = dépense).
CREATE TABLE operations (
  id            TEXT PRIMARY KEY,
  compte        TEXT NOT NULL,
  date          TEXT NOT NULL,      -- AAAA-MM-JJ
  montant       INTEGER NOT NULL,
  libelle       TEXT NOT NULL,
  contrepartie  TEXT,
  statut        TEXT NOT NULL,      -- BOOK (comptabilisée) | PDNG (en cours)
  brut          TEXT,
  vu            TEXT NOT NULL       -- première apparition dans l'app
);
CREATE INDEX operations_date ON operations (date);
CREATE INDEX operations_compte ON operations (compte, date);

-- Petits réglages et états divers (clé → JSON).
CREATE TABLE reglages (
  cle     TEXT PRIMARY KEY,
  valeur  TEXT NOT NULL
);
