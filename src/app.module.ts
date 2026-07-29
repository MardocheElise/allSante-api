import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InteropModule } from './interop/interop.module';
import { NationalModule } from './national/national.module';
import { PortailModule } from './portail/portail.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';

/**
 * All_Santé assure trois rôles complémentaires :
 *   • InteropModule — bus FHIR sans état (routage SGCH/DPI/OpenELIS) ;
 *   • NationalModule — dépôt national (identité pivot + historique partagé),
 *     adossé à la base `allsante_global` via PrismaModule ;
 *   • PortailModule — portail développeur : c'est par lui qu'un établissement
 *     obtient l'identité qu'il prouvera ensuite à chaque appel.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    InteropModule,
    NationalModule,
    PortailModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
