-- private.raise_error only raises; it never reads or writes data. Marking it
-- STABLE lets STABLE permission checks call it without lint warnings.
alter function private.raise_error(text, jsonb) stable;
