import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateProjectDto } from './create-project.dto';

describe('CreateProjectDto', () => {
  it("accepts the current catalog repo shape 'single-app'", async () => {
    const dto = plainToInstance(CreateProjectDto, {
      repoName: 'orders-api',
      visibility: 'private',
      repoShape: 'single-app',
      projectTypeId: 'nestjs-api',
      serviceName: 'orders-api',
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });
});