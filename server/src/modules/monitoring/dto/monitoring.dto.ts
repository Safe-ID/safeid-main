import { StrictBoolean } from '../../../shared/validation/strict-boolean';

export class MonitoringPreferencesDto {
  @StrictBoolean()
  enabled!: boolean;
}
