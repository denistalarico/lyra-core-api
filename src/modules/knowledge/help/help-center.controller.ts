import {
  Controller,
  Get,
  Injectable,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ClientAreaAuthGuard } from '../../client-area/guards/client-area.guards';
import { HelpCenterService } from './help-center.service';
import { HelpLocaleQueryDto, ListHelpArticlesQueryDto } from './dto';

/**
 * Official Lyra Help Center — READ ONLY.
 *
 * Each surface authenticates its own session before reading this catalog.
 * There are intentionally NO create/update/delete routes here: tenant users
 * cannot edit, publish or remove official content. Content is global (not
 * tenant-scoped), so nothing here touches tenant data and nothing tenant-private
 * can leak. Tenant/company content lives under `agency/knowledge/*` and is never
 * returned by these endpoints.
 */
@Injectable()
class HelpCenterReadRoutes {
  constructor(private readonly helpCenter: HelpCenterService) {}

  @Get('overview')
  overview(@Query() query: HelpLocaleQueryDto) {
    return this.helpCenter.getOverview(query.locale);
  }

  @Get('categories')
  categories(@Query() query: HelpLocaleQueryDto) {
    return this.helpCenter.listCategories(query.locale);
  }

  @Get('trails')
  trails(@Query() query: HelpLocaleQueryDto) {
    return this.helpCenter.listTrails(query.locale);
  }

  @Get('trails/:slug')
  trail(@Param('slug') slug: string, @Query() query: HelpLocaleQueryDto) {
    return this.helpCenter.getTrailBySlug(slug, query.locale);
  }

  @Get('articles')
  articles(@Query() query: ListHelpArticlesQueryDto) {
    return this.helpCenter.listArticles({
      locale: query.locale,
      categoryKey: query.categoryKey,
      search: query.search,
    });
  }

  @Get('articles/:slug')
  article(
    @Param('slug') slug: string,
    @Query('locale') locale?: string,
    @Query('trail') trail?: string,
  ) {
    return this.helpCenter.getArticleBySlug(slug, { locale, trailSlug: trail });
  }
}

@Controller('agency/knowledge/help')
@UseGuards(JwtAuthGuard)
export class HelpCenterController extends HelpCenterReadRoutes {}

@Controller('client-area/help')
@UseGuards(ClientAreaAuthGuard)
export class ClientAreaHelpCenterController extends HelpCenterReadRoutes {}
