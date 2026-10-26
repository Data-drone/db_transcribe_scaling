import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@databricks/appkit-ui/react';

export function DemoStatePage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-semibold">{title}</h2>
        <Badge variant="outline">Demo state</Badge>
      </div>
      <Alert>
        <AlertTitle>Not connected to persistent storage</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Why this screen is intentionally limited</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            The selected integration scope is read-only Analytics. The live Unity Catalog schema does not yet contain the app-state tables from the product spec.
          </p>
          <p>
            Persisting this workflow requires either Lakebase for interactive writes or Delta tables plus governed write endpoints. No workspace resource was created silently.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
