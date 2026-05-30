import type { FormSkill, FormFieldMeta } from './types.js';

export class SkillRegistry {
  private skills: FormSkill[] = [];

  register(skill: FormSkill): void {
    this.skills.push(skill);
  }

  match(field: FormFieldMeta): FormSkill | null {
    for (const skill of this.skills) {
      if (skill.match(field)) return skill;
    }
    return null;
  }

  clear(): void {
    this.skills = [];
  }
}