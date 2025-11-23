import ModernPropertiesPage from '../../components/properties/ModernPropertiesPage';

export default function ApprovedPropertiesPage() {
  return (
    <ModernPropertiesPage 
      apiEndpoint="/api/v1/approved-properties"
      pageTitle="נכסים מאושרים לתיווך"
    />
  );
}

