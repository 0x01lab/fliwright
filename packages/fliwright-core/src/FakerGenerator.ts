import { faker } from '@faker-js/faker';
import type { SemanticType } from './types.js';

export interface FakerGeneratorOptions {
  locale?: string;
}

export class FakerGenerator {
  private readonly fakerInstance: typeof faker;

  constructor(options?: FakerGeneratorOptions) {
    this.fakerInstance = faker;
    // Locale-specific generation is handled by preset skills or locale-specific rules.
  }

  generate(semanticType: SemanticType, maxLength?: number): string {
    let value: string;
    switch (semanticType) {
      case 'phone':
        value = this.generatePhone();
        break;
      case 'email':
        value = this.fakerInstance.internet.email();
        break;
      case 'idCard':
        value = this.generateIdCard();
        break;
      case 'fullName':
        value = this.fakerInstance.person.fullName();
        break;
      case 'address':
        value = this.fakerInstance.location.streetAddress({ useFullAddress: true as never });
        break;
      case 'password':
        value = this.generatePassword(maxLength);
        break;
      case 'captcha':
        value = this.fakerInstance.string.numeric({ length: { min: 4, max: 6 } });
        break;
      case 'number':
        value = this.fakerInstance.string.numeric({ length: { min: 1, max: 5 } });
        break;
      case 'text':
        value = this.fakerInstance.lorem.sentence();
        break;
      case 'url':
        value = this.fakerInstance.internet.url();
        break;
      case 'date':
        value = this.fakerInstance.date.recent().toISOString().slice(0, 10);
        break;
      case 'boolean':
        value = 'true';
        break;
      case 'option':
        value = '';
        break;
      default:
        value = this.fakerInstance.lorem.word();
    }
    if (maxLength != null && value.length > maxLength) {
      value = value.slice(0, maxLength);
    }
    return value;
  }

  private generatePhone(): string {
    const prefix = `1${[3, 4, 5, 6, 7, 8, 9][Math.floor(Math.random() * 7)]}`;
    const suffix = this.fakerInstance.string.numeric({ length: 9 });
    return prefix + suffix;
  }

  private generateIdCard(): string {
    const region = this.fakerInstance.string.numeric({ length: 6, allowLeadingZeros: true });
    const year = this.fakerInstance.number.int({ min: 1960, max: 2005 }).toString();
    const month = this.fakerInstance.number.int({ min: 1, max: 12 }).toString().padStart(2, '0');
    const day = this.fakerInstance.number.int({ min: 1, max: 28 }).toString().padStart(2, '0');
    const seq = this.fakerInstance.string.numeric({ length: 3 });
    const base = region + year + month + day + seq;
    const checksum = this.computeIdChecksum(base);
    return base + checksum;
  }

  private computeIdChecksum(base: string): string {
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const checkChars = '10X98765432';
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      sum += parseInt(base[i]) * weights[i];
    }
    return checkChars[sum % 11];
  }

  private generatePassword(maxLength?: number): string {
    const len = Math.min(maxLength ?? 12, 32);
    const lower = this.fakerInstance.string.alpha({ length: Math.ceil(len / 4), casing: 'lower' });
    const upper = this.fakerInstance.string.alpha({ length: Math.ceil(len / 4), casing: 'upper' });
    const digits = this.fakerInstance.string.numeric({ length: Math.ceil(len / 4) });
    const symbols = '!@#$%^&*';
    const special = Array.from({ length: Math.max(1, len - lower.length - upper.length - digits.length) },
      () => symbols[Math.floor(Math.random() * symbols.length)]).join('');
    const combined = (lower + upper + digits + special).slice(0, len);
    return combined.split('').sort(() => Math.random() - 0.5).join('');
  }
}
