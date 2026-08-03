import { BadRequestException } from '@nestjs/common';
import {
  getCompanyContextRootKeys,
  isForbiddenCompanyContextKey,
} from '../../leadflow-settings/services/company-context.service';
import type { LeadFlowJsonObject } from '../../leadflow-settings/types/leadflow-settings.types';

interface FieldPathSegment {
  key: string;
  index: number | null;
}

const SEGMENT_PATTERN = /^([a-zA-Z][a-zA-Z0-9]*)(\[(\d+)\])?$/;

/** Parses `identity.publicName` / `offers[2].title` into ordered key/index segments. */
export function parseFieldPath(fieldPath: string): FieldPathSegment[] {
  if (!fieldPath) throw new BadRequestException('Field path is required.');

  return fieldPath.split('.').map((raw) => {
    const match = SEGMENT_PATTERN.exec(raw);
    if (!match) {
      throw new BadRequestException(`Invalid field path segment: ${raw}.`);
    }
    return {
      key: match[1],
      index: match[3] !== undefined ? Number(match[3]) : null,
    };
  });
}

/** A field path is valid when its root segment is a known company-context section and no segment is a forbidden/secret-like key. */
export function isValidFieldPath(fieldPath: string): boolean {
  try {
    const segments = parseFieldPath(fieldPath);
    if (segments.length === 0) return false;
    if (!getCompanyContextRootKeys().includes(segments[0].key)) return false;
    return !segments.some((segment) => isForbiddenCompanyContextKey(segment.key));
  } catch {
    return false;
  }
}

export function getAtFieldPath(draft: LeadFlowJsonObject, fieldPath: string): unknown {
  let cursor: unknown = draft;
  for (const segment of parseFieldPath(fieldPath)) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment.key];
    if (segment.index !== null) {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[segment.index];
    }
  }
  return cursor;
}

/** Returns a new draft with exactly one field replaced — never mutates the input, never touches sibling fields. */
export function setAtFieldPath(
  draft: LeadFlowJsonObject,
  fieldPath: string,
  value: unknown,
): LeadFlowJsonObject {
  return setAtSegments(draft, parseFieldPath(fieldPath), value) as LeadFlowJsonObject;
}

function setAtSegments(
  node: unknown,
  segments: FieldPathSegment[],
  value: unknown,
): unknown {
  const [segment, ...rest] = segments;
  const object = isPlainObject(node) ? { ...node } : {};

  if (segment.index === null) {
    object[segment.key] = rest.length === 0 ? value : setAtSegments(object[segment.key], rest, value);
    return object;
  }

  const array = Array.isArray(object[segment.key])
    ? [...(object[segment.key] as unknown[])]
    : [];
  while (array.length <= segment.index) array.push(undefined);
  array[segment.index] =
    rest.length === 0 ? value : setAtSegments(array[segment.index], rest, value);
  object[segment.key] = array;
  return object;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
