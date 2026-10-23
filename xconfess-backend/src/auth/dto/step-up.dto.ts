import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

/**
 * Payload for {@link AuthController.stepUp}. Exactly one of `password` or
 * `totpToken` should be supplied to re-prove control of the account.
 *
 * This guard is reused by the account merge / anonymous identity transfer
 * workflow. Merge attempts must be authorized with a step-up proof, so the
 * same constraints apply: exactly one credential field must be present and
 * non-empty.
 */
export class StepUpDto {
  @IsOptional()
  @IsString({ message: 'Password must be a string' })
  @MinLength(1, { message: 'Password must not be empty' })
  password?: string;

  @IsOptional()
  @IsString({ message: 'TOTP must be a string' })
  @MinLength(6, { message: 'TOTP must be 6 digits' })
  @MaxLength(10, { message: 'TOTP token is too long' })
  totpToken?: string;

  @IsOptional()
  @IsString({ message: 'Recovery code must be a string' })
  @MinLength(8, { message: 'Recovery code is too short' })
  @MaxLength(64, { message: 'Recovery code is too long' })
  recoveryCode?: string;

  /**
   * Base64url-encoded WebAuthn assertion response (PublicKeyCredential.json).
   * Verified against the stored challenge, origin, and RP id by the WebAuthn service.
   */
  @IsOptional()
  @IsString({ message: 'WebAuthn assertion must be a string' })
  @MinLength(1, { message: 'WebAuthn assertion must not be empty' })
  webAuthnAssertion?: string;

  /**
   * Opaque challenge identifier issued by the server for this step-up attempt.
   * Required when `webAuthnAssertion` is present so replayed assertions can be rejected.
   */
  @IsOptional()
  @IsString({ message: 'WebAuthn challenge id must be a string' })
  @MinLength(1, { message: 'WebAuthn challenge id must not be empty' })
  webAuthnChallengeId?: string;
}
