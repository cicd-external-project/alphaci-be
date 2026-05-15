import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { LocationService } from './location.service.js';

@Controller('location')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  @Get('resolve')
  async resolve(
    @Query('ip') ip?: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    const latitude = lat ? parseFloat(lat) : undefined;
    const longitude = lng ? parseFloat(lng) : undefined;
    
    // Sends the request to the APICenter SDK 
    // The Frontend (React/Leaflet) will call this endpoint
    return this.locationService.resolveLocation(ip, latitude, longitude);
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
