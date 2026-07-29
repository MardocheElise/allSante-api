import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { InteropController } from './interop.controller';
import { InteropService } from './interop.service';

@Module({
  imports: [HttpModule],
  controllers: [InteropController],
  providers: [InteropService],
})
export class InteropModule {}
