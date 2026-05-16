import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Query,
} from '@nestjs/common';
import { LocationService } from './location.service.js';

@Controller('location')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  @Get('resolve')
  async resolve(@Query('lat') lat?: string, @Query('lng') lng?: string) {
    const latitude = lat !== undefined ? parseFloat(lat) : undefined;
    const longitude = lng !== undefined ? parseFloat(lng) : undefined;

    if (latitude === undefined || longitude === undefined) {
      throw new BadRequestException(
        'lat and lng query parameters are required',
      );
    }

    return this.locationService.resolveLocation(latitude, longitude);
  }

  @Post('geofence')
  async checkFence(
    @Body() body: { latitude: number; longitude: number; fenceId?: string },
  ) {
    return this.locationService.checkGeofence(
      body.latitude,
      body.longitude,
      body.fenceId,
    );
  }
}
