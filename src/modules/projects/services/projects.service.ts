import { Injectable } from '@nestjs/common';

@Injectable()
export class ProjectsService {
  health() {
    return {
      module: 'projects',
      status: 'ok',
      scope: 'agency-projects-tasks',
    };
  }
}
