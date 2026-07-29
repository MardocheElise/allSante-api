// ─────────────────────────────────────────────────────────────────────────────
// Interopérabilité — Contrat FHIR R4 (DPI → OpenELIS) : demande d'examen
//
// À la finalisation d'une consultation, le DPI transmet au laboratoire OpenELIS
// les examens complémentaires demandés (portée INTERNE = réalisés par le labo
// de l'hôpital). Le message est un Bundle FHIR contenant :
//   • une ressource Patient        (identité, portée par le matricule CMU) ;
//   • une ou plusieurs ServiceRequest (les demandes d'examen).
//
// Identifiants pivots :
//   • matricule CMU              → identité patient partagée ;
//   • numeroDemande (ServiceRequest.identifier) → partagé avec OpenELIS.DemandeLabo.
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEME_CMU = 'https://interop.sante.ci/cmu/matricule';
export const SYSTEME_NUMERO_DEMANDE =
  'https://dpi.sante.ci/demande-examen/numero';

export type TypeExamenFhir = 'BIOLOGIE' | 'IMAGERIE';

// ── Types FHIR (sous-ensemble utilisé) ──────────────────────────────────────
export interface FhirIdentifier {
  system: string;
  value: string;
}

export interface FhirPatientRes {
  resourceType: 'Patient';
  identifier: FhirIdentifier[];
  name: { family: string; given: string[] }[];
  gender?: 'male' | 'female' | 'unknown';
  birthDate?: string;
  telecom?: { system: 'phone' | 'email'; value: string }[];
}

export interface FhirServiceRequest {
  resourceType: 'ServiceRequest';
  status: 'active';
  intent: 'order';
  identifier: FhirIdentifier[];
  subject: { identifier: FhirIdentifier };
  category: { text: TypeExamenFhir }[];
  code?: { text: string };
  orderDetail?: { text: string }[];
  requester?: { display: string };
  reasonCode?: { text: string }[];
  encounter?: { identifier: FhirIdentifier };
  extension: { url: string; valueString?: string }[];
}

export interface FhirBundleDemande {
  resourceType: 'Bundle';
  type: 'message';
  timestamp: string;
  entry: { fullUrl: string; resource: FhirPatientRes | FhirServiceRequest }[];
}

// ── Données source (côté DPI) ───────────────────────────────────────────────
export interface SourcePatientDemande {
  matriculeCMU: string;
  nom: string;
  prenom: string | null;
  genre: 'masculin' | 'feminin';
  dateNaissance: Date;
  contact: string;
}

export interface SourceDemande {
  numeroDemande: string;
  nature: string | null;
  actes: string[];
  priorite: string | null;
  renseignementClinique: string | null;
  referenceConsultation: string;
  prescripteur: string | null;
}

const REGEX_IMAGERIE =
  /imag|radio|écho|echo|scanner|scan|irm|tdm|scintig|mammo|doppler/i;

/** Déduit le type d'examen (BIOLOGIE par défaut) à partir de la nature. */
export function deduireType(nature: string | null): TypeExamenFhir {
  return nature && REGEX_IMAGERIE.test(nature) ? 'IMAGERIE' : 'BIOLOGIE';
}

function toIsoDate(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Construit le Bundle FHIR d'une prescription d'examens (Patient + N
 * ServiceRequest) destiné au laboratoire OpenELIS.
 */
export function construireBundleDemandesExamen(
  patient: SourcePatientDemande,
  demandes: SourceDemande[],
): FhirBundleDemande {
  const identifiantCMU: FhirIdentifier = {
    system: SYSTEME_CMU,
    value: patient.matriculeCMU,
  };

  const ressourcePatient: FhirPatientRes = {
    resourceType: 'Patient',
    identifier: [identifiantCMU],
    name: [
      { family: patient.nom, given: patient.prenom ? [patient.prenom] : [] },
    ],
    gender: patient.genre === 'masculin' ? 'male' : 'female',
    birthDate: toIsoDate(patient.dateNaissance),
    telecom: [{ system: 'phone', value: patient.contact }],
  };

  const services: { fullUrl: string; resource: FhirServiceRequest }[] =
    demandes.map((d) => ({
      fullUrl: `urn:demande:${d.numeroDemande}`,
      resource: {
        resourceType: 'ServiceRequest',
        status: 'active',
        intent: 'order',
        identifier: [
          { system: SYSTEME_NUMERO_DEMANDE, value: d.numeroDemande },
        ],
        subject: { identifier: identifiantCMU },
        category: [{ text: deduireType(d.nature) }],
        code: d.nature ? { text: d.nature } : undefined,
        orderDetail: (d.actes ?? []).map((a) => ({ text: a })),
        requester: d.prescripteur ? { display: d.prescripteur } : undefined,
        reasonCode: d.renseignementClinique
          ? [{ text: d.renseignementClinique }]
          : undefined,
        encounter: {
          identifier: {
            system: 'https://dpi.sante.ci/consultation',
            value: d.referenceConsultation,
          },
        },
        extension: [
          ...(d.priorite ? [{ url: 'priorite', valueString: d.priorite }] : []),
        ],
      },
    }));

  return {
    resourceType: 'Bundle',
    type: 'message',
    timestamp: new Date().toISOString(),
    entry: [
      {
        fullUrl: `urn:cmu:${patient.matriculeCMU}`,
        resource: ressourcePatient,
      },
      ...services,
    ],
  };
}
