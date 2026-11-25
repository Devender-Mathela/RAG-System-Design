import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { AiService } from './ai.service';
import { InterviewService } from './interview.service';
import { AiController } from './ai.controller';

@Module({
  imports: [MetricsModule],
  controllers: [AiController],
  providers: [AiService, InterviewService],
  exports: [AiService, InterviewService],
})
export class AiModule {}
