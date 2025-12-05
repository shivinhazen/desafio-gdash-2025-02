import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export type WeatherLogDocument = WeatherLog & Document;

@Schema({
  timestamps: true,
})
export class WeatherLog {
  @Prop({ required: true })
  city: string;

  @Prop({ required: true, type: Date })
  timestamp: Date;

  @Prop({ required: true })
  source: string;

  @Prop({ required: true, type: Object })
  metrics: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  meta: Record<string, string>;
}

export const WeatherLogSchema = SchemaFactory.createForClass(WeatherLog);
// Garante idempotência: um registro único por cidade + timestamp.
WeatherLogSchema.index({ city: 1, timestamp: 1 }, { unique: true });
