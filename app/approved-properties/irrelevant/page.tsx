import ModernPropertiesPage from '../../../components/properties/ModernPropertiesPage';

// Approved properties that were marked "irrelevant" (e.g. rented not through us). They live here
// instead of the main approved list, and carry a ~1-year recheck reminder to שי/זיו.
export default function IrrelevantApprovedPropertiesPage() {
  return (
    <ModernPropertiesPage
      apiEndpoint="/api/v1/approved-properties"
      extraParams={{ irrelevant: '1' }}
      pageTitle="נכסים מאושרים — לא רלוונטיים"
    />
  );
}
