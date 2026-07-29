import { Controller, Get } from "@nestjs/common";
import { chargerConfig } from "../config/interop.config";

/** Sonde de disponibilité + inventaire des routes aval (non authentifiée). */
@Controller()
export class HealthController {
  @Get("health")
  health() {
    const c = chargerConfig();
    return {
      service: "allsante-api",
      statut: "ok",
      horodatage: new Date().toISOString(),
      routes: {
        "prise-en-charge": `${c.dpi.url}/interop/fhir/prise-en-charge`,
        "demande-examen": `${c.openelis.url}/interop/fhir/demande-examen`,
        resultats: `${c.dpi.url}/interop/fhir/resultats`,
      },
      // Dépôt national (base allsante_global) — identité pivot + historique.
      national: {
        identite: "GET /national/patients/:matricule",
        historique: "GET /national/patients/:matricule/consultations",
        publierIdentite: "POST /national/patients",
        publierConsultation: "POST /national/consultations",
      },
    };
  }
}
