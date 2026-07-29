import { Module } from '@nestjs/common';
import { NationalController } from './national.controller';
import { NationalService } from './national.service';

/** Dépôt national : identité pivot + historique clinique partagé. */
@Module({
  controllers: [NationalController],
  providers: [NationalService],
  exports: [NationalService],
})
export class NationalModule {}
