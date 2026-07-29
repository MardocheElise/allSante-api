import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CompteGuard, RequeteAvecCompte } from './compte.guard';
import { PortailService } from './portail.service';

/**
 * Portail développeur — inscription, connexion, gestion des clés API.
 *
 * Routes publiques : /portail/inscription et /portail/connexion.
 * Le reste exige un jeton de session (Authorization: Bearer …).
 */
@Controller('portail')
export class PortailController {
  constructor(private readonly portail: PortailService) {}

  /** Crée le compte ET son établissement. Le code est dérivé du nom saisi. */
  @Post('inscription')
  @HttpCode(201)
  inscrire(@Body() payload: unknown) {
    return this.portail.inscrire(payload);
  }

  @Post('connexion')
  @HttpCode(200)
  connecter(@Body() payload: unknown) {
    return this.portail.connecter(payload);
  }

  @Get('profil')
  @UseGuards(CompteGuard)
  profil(@Req() req: RequeteAvecCompte) {
    return this.portail.profil(req.compteId!);
  }

  /** Génère une clé. Elle est renvoyée en clair UNE SEULE FOIS. */
  @Post('cles')
  @HttpCode(201)
  @UseGuards(CompteGuard)
  creerCle(@Req() req: RequeteAvecCompte, @Body() payload: unknown) {
    return this.portail.creerCle(req.compteId!, payload);
  }

  /** Liste les clés de l'établissement : préfixes seuls. */
  @Get('cles')
  @UseGuards(CompteGuard)
  listerCles(@Req() req: RequeteAvecCompte) {
    return this.portail.listerCles(req.compteId!);
  }

  @Delete('cles/:id')
  @HttpCode(200)
  @UseGuards(CompteGuard)
  revoquerCle(
    @Req() req: RequeteAvecCompte,
    @Param('id') id: string,
    @Query('motif') motif?: string,
  ) {
    return this.portail.revoquerCle(req.compteId!, id, motif);
  }

  /** Adresses des systèmes de l'établissement (cibles de routage FHIR). */
  @Get('systemes')
  @UseGuards(CompteGuard)
  lireSystemes(@Req() req: RequeteAvecCompte) {
    return this.portail.lireSystemes(req.compteId!);
  }

  @Put('systemes')
  @HttpCode(200)
  @UseGuards(CompteGuard)
  majSystemes(@Req() req: RequeteAvecCompte, @Body() payload: unknown) {
    return this.portail.majSystemes(req.compteId!, payload);
  }
}
