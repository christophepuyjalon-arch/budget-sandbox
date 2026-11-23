// Budget — catégories, règles et projets de départ.
// Tout est modifiable ensuite dans l'app : ces valeurs ne servent qu'au premier lancement.

// type : fixe (charges prévisibles), enveloppe (dépenses courantes, anneaux),
//        suivi (sans budget), hors (jamais compté comme dépense : revenus, virements…)
export const CATEGORIES = [
  ['loyers', 'Loyers et traites', 'fixe', 250000],
  ['banque', 'Banque et assurance', 'fixe', 228500],
  ['scolarite', 'Scolarité et études', 'fixe', 86700],
  ['courses', 'Courses', 'enveloppe', 160000],
  ['shopping', 'Shopping', 'enveloppe', 74000],
  ['transports', 'Transports', 'enveloppe', 24000],
  ['sante', 'Santé', 'suivi', 0],
  ['loisirs', 'Loisirs et vacances', 'suivi', 0],
  ['travaux', 'Travaux', 'suivi', 0],
  ['impots', 'Impôts', 'suivi', 0],
  ['pro', 'Frais professionnels', 'suivi', 0],
  ['revenus', 'Revenus', 'hors', 0],
  ['virements', 'Virements internes', 'hors', 0],
  ['differe', 'Débit différé carte', 'hors', 0],
];

// Motifs recherchés dans le libellé ou le nom du commerçant (majuscules, sans accents).
// Le motif le plus long l'emporte ; tes propres règles passent toujours avant celles-ci.
export const REGLES = {
  courses: ['CARREFOUR', 'LECLERC', 'AUCHAN', 'INTERMARCHE', 'LIDL', 'ALDI', 'MONOPRIX', 'FRANPRIX', 'CASINO', 'SUPER U', 'HYPER U',
    'U EXPRESS', 'SYSTEME U', 'BIOCOOP', 'NATURALIA', 'QUITOQUE', 'PICARD', 'GRAND FRAIS', 'NETTO', 'COLRUYT', 'MARCHE U',
    'BOULANGERIE', 'BOUCHERIE', 'PRIMEUR', 'FROMAGERIE', 'POISSONNERIE', 'CAVE', 'PATISSERIE'],
  shopping: ['AMAZON', 'AMZN', 'ZALANDO', 'FNAC', 'DARTY', 'BOULANGER', 'DECATHLON', 'IKEA', 'ZARA', 'H&M', 'KIABI', 'VINTED', 'SHEIN',
    'CDISCOUNT', 'UNIQLO', 'SEPHORA', 'NOCIBE', 'CULTURA', 'ACTION', 'GIFI', 'MAISONS DU MONDE', 'APPLE.COM', 'GOOGLE PLAY', 'PAYPAL'],
  transports: ['TOTALENERGIES RELAIS', 'ESSO', 'SHELL', 'AVIA', 'STATION', 'CARBURANT', 'SNCF', 'OUIGO', 'UBER', 'BLABLACAR', 'PEAGE',
    'AUTOROUTE', 'VINCI', 'APRR', 'SANEF', 'PARKING', 'INDIGO', 'EFFIA', 'TBM', 'YELO', 'VITALIS', 'NORAUTO', 'FEU VERT', 'SPEEDY'],
  sante: ['PHARMACIE', 'PHARMA', 'MEDECIN', 'DOCTEUR', 'DENTISTE', 'KINE', 'LABORATOIRE', 'LABO ', 'OPTIC', 'OPTIQUE', 'CPAM',
    'MUTUELLE', 'HOPITAL', 'CLINIQUE', 'DOCTOLIB'],
  loyers: ['LOYER', 'ECHEANCE PRET', 'PRET IMMO', 'EDF', 'ENGIE', 'ENERGIES', 'VEOLIA', 'SAUR', 'SUEZ', 'ORANGE', 'SOSH', 'SFR',
    'BOUYGUES', 'FREE MOBILE', 'FREE TELECOM', 'RED BY SFR', 'NETFLIX', 'SPOTIFY', 'DISNEY', 'CANAL', 'DEEZER', 'SYNDIC'],
  banque: ['COTISATION', 'FRAIS', 'COMMISSION', 'AGIOS', 'ASSURANCE', 'MAIF', 'MACIF', 'MAAF', 'MATMUT', 'AXA', 'ALLIANZ',
    'GROUPAMA', 'GMF', 'CNP', 'PREDICA', 'LIVRET', 'EPARGNE', 'PEL', 'ASSURANCE VIE'],
  scolarite: ['ECOLE', 'COLLEGE', 'LYCEE', 'UNIVERSITE', 'CANTINE', 'CRECHE', 'PERISCOLAIRE', 'SCOLARITE'],
  impots: ['DGFIP', 'IMPOT', 'FINANCES PUBLIQUES', 'TRESOR PUBLIC'],
  loisirs: ['RESTAURANT', 'CINEMA', 'CINE ', 'MCDONALD', 'BURGER KING', 'KFC', 'DELIVEROO', 'UBER EATS', 'BAR ', 'BRASSERIE',
    'AIRBNB', 'BOOKING', 'HOTEL', 'TICKETMASTER', 'FNAC SPECTACLES'],
  travaux: ['LEROY MERLIN', 'CASTORAMA', 'BRICO', 'BRICOMARCHE', 'POINT P', 'WELDOM', 'MR BRICOLAGE'],
  differe: ['DEBIT DIFFERE', 'FACTURE CARTE', 'FACTURES CARTE', 'RELEVE CARTE', 'TOTAL CARTE', 'DEPENSES CARTE'],
};

// Projets : budget, période (mois de début et de fin), motif facultatif pour rattacher
// automatiquement les opérations de la période (ex. DGFIP pour les impôts).
export const PROJETS = [
  ['impots-2025', 'Rattrapage impôts 2025', 400000, '2026-09', '2026-12', 'DGFIP'],
  ['italie', 'Voyage en Italie à Noël', 400000, '2026-12', '2027-01', null],
  ['ski', 'Ski en février', 200000, '2027-02', '2027-02', null],
  ['cadeaux', 'Cadeaux de Noël', 60000, '2026-11', '2026-12', null],
];
