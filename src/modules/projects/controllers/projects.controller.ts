import { Controller, Get } from '@nestjs/common';
import { ProjectsService } from '../services/projects.service';

@Controller('agency/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get('health')
  health() {
    return this.projectsService.health();
  }
}
