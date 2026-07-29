// ─────────────────────────────────────────────────────────────────────────────
// Dérivation du code établissement à partir de son nom.
//
// Le code voyage dans chaque ligne du journal d'accès : il doit rester lisible
// par un humain qui audite la base six mois plus tard. « CHR de Bouaké » donne
// « CHR-BOUAKE », pas un identifiant opaque.
// ─────────────────────────────────────────────────────────────────────────────

/** Mots vides ignorés : ils n'apportent rien à l'identification. */
const MOTS_VIDES = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'et',
  'a',
  'au',
  'aux',
  'l',
  'd',
]);

const LONGUEUR_MAX = 24;

/**
 * Transforme un nom d'établissement en code court, stable et lisible.
 *
 *   « CHU d'Abidjan — Cocody »        → CHU-ABIDJAN-COCODY
 *   « Centre de Santé Urbain d'Adjamé » → CENTRE-SANTE-URBAIN-ADJAME
 *   « Clinique la Providence »        → CLINIQUE-PROVIDENCE
 */
export function deriverCode(nom: string): string {
  const sansAccents = nom
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // retire les diacritiques
    .toUpperCase();

  const mots = sansAccents
    .replace(/['’]/g, ' ') // l'apostrophe sépare, elle ne colle pas
    .replace(/[^A-Z0-9]+/g, ' ') // tout le reste devient séparateur
    .trim()
    .split(/\s+/)
    .filter((mot) => mot.length > 0 && !MOTS_VIDES.has(mot.toLowerCase()));

  if (mots.length === 0) return 'ETAB';

  let code = mots.join('-');
  if (code.length > LONGUEUR_MAX) {
    // On tronque sur une frontière de mot plutôt qu'au milieu d'un nom.
    const retenus: string[] = [];
    let longueur = 0;
    for (const mot of mots) {
      const ajout = retenus.length === 0 ? mot.length : mot.length + 1;
      if (longueur + ajout > LONGUEUR_MAX) break;
      retenus.push(mot);
      longueur += ajout;
    }
    code = retenus.length > 0 ? retenus.join('-') : mots[0].slice(0, LONGUEUR_MAX);
  }

  return code;
}

/**
 * Rend le code unique en le suffixant si nécessaire : CHR-BOUAKE, CHR-BOUAKE-2,
 * CHR-BOUAKE-3… Deux établissements peuvent légitimement porter le même nom
 * dans deux villes différentes.
 */
export function rendreUnique(
  codeBase: string,
  estPris: (code: string) => Promise<boolean>,
): Promise<string> {
  return (async () => {
    if (!(await estPris(codeBase))) return codeBase;
    for (let suffixe = 2; suffixe <= 99; suffixe++) {
      const candidat = `${codeBase}-${suffixe}`;
      if (!(await estPris(candidat))) return candidat;
    }
    // Cas extrême : on bascule sur un suffixe aléatoire plutôt que d'échouer.
    return `${codeBase}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  })();
}
