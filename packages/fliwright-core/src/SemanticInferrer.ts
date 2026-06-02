import type { FormFieldMeta, SemanticType } from './types.js';

interface PatternRule {
  regex: RegExp;
  type: SemanticType;
}

const HINT_PATTERNS: PatternRule[] = [
  { regex: /手机|phone|mobile/i, type: 'phone' },
  { regex: /邮箱|email|e-mail/i, type: 'email' },
  { regex: /身份证|ID.?card|身份证号/i, type: 'idCard' },
  { regex: /地址|address|addr/i, type: 'address' },
  { regex: /姓名|full.?name|真实姓名/i, type: 'fullName' },
  { regex: /密码|password|pwd/i, type: 'password' },
  { regex: /验证码|captcha|verification.?code/i, type: 'captcha' },
  { regex: /日期|date|birthday|生日/i, type: 'date' },
];

const KEYBOARD_TYPE_MAP: Record<string, SemanticType> = {
  phone: 'phone',
  emailAddress: 'email',
  number: 'number',
  url: 'url',
  visiblePassword: 'password',
};

export class SemanticInferrer {
  infer(fields: FormFieldMeta[]): Map<string, SemanticType> {
    const result = new Map<string, SemanticType>();
    for (const field of fields) {
      result.set(field.id, this.inferField(field));
    }
    return result;
  }

  private inferField(field: FormFieldMeta): SemanticType {
    if (field.controlType === 'checkbox') return 'boolean';
    if (field.controlType === 'radio' || field.controlType === 'select') {
      return 'option';
    }

    const text = field.hintText ?? field.label ?? '';
    for (const rule of HINT_PATTERNS) {
      if (rule.regex.test(text)) return rule.type;
    }
    if (field.keyboardType && field.keyboardType in KEYBOARD_TYPE_MAP) {
      return KEYBOARD_TYPE_MAP[field.keyboardType];
    }
    return 'text';
  }
}
