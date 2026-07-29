// ─────────────────────────────────────────────────────────────────────────────
// Configuration du bus d'interopérabilité All_Santé.
//
// AllSanté est un HUB : chaque système appelle AllSanté (au lieu du point-à-
// point), AllSanté authentifie + valide + route vers le bon système aval.
// La configuration est purement issue de l'environnement (12-factor) : aucun
// secret n'est codé en dur.
// ─────────────────────────────────────────────────────────────────────────────

export interface CibleAval {
  /** URL de base du système aval (ex. http://localhost:3001). */
  url: string;
  /** Clé API transmise à ce système aval dans l'en-tête x-api-key. */
  cle: string;
}

export interface InteropConfig {
  port: number;
  /** Clé API exigée des clients ENTRANTS (SGCH, DPI, OpenELIS → AllSanté). */
  cleEntrante: string;
  /** Délai d'expiration des appels aval (ms). */
  timeoutMs: number;
  dpi: CibleAval;
  openelis: CibleAval;
}

/** Construit la configuration typée à partir des variables d'environnement. */
export function chargerConfig(): InteropConfig {
  const cleEntrante =
    process.env.INTEROP_API_KEY ?? "dev-interop-key-change-me";
  return {
    port: Number.parseInt(process.env.PORT ?? "3010", 10),
    cleEntrante,
    timeoutMs: Number.parseInt(process.env.INTEROP_TIMEOUT_MS ?? "8000", 10),
    dpi: {
      url: process.env.DPI_INTEROP_URL ?? "http://localhost:3001",
      cle: process.env.DPI_API_KEY || cleEntrante,
    },
    openelis: {
      url: process.env.OPENELIS_INTEROP_URL ?? "http://localhost:3021",
      cle: process.env.OPENELIS_API_KEY || cleEntrante,
    },
  };
}
