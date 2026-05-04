-- Allow admins to delete any inventory submission
-- Allow the submitter to delete their own submission
CREATE POLICY "admins and owners can delete inventory submissions"
  ON inventory_submissions
  FOR DELETE
  USING (
    -- admin check: role stored in profiles table
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
    OR
    -- owner check: submitted_by matches the current user
    submitted_by = auth.uid()
  );
