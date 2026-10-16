import { requirePageRole } from "@/lib/auth/guards";
import { getDepartments } from "@/features/departments/department.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Building2, AlertCircle } from "lucide-react";
import { CreateDepartmentForm, DeleteDepartmentButton } from "./DepartmentForms";

export default async function DepartmentsPage() {
  await requirePageRole("admin");
  const departments = await getDepartments();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-zinc-50 to-teal-50 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 p-6 lg:p-10">
      <div className="max-w-5xl mx-auto space-y-10">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
          <div className="flex items-start gap-5">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-600 to-teal-600 flex items-center justify-center shadow-lg flex-shrink-0">
              <Building2 className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-tighter text-zinc-900 dark:text-white">
                Departments
              </h1>
              <p className="text-zinc-600 dark:text-zinc-400 mt-2 text-lg max-w-md">
                Manage hospital departments and medical specialties
              </p>
            </div>
          </div>

          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            Total Departments:{" "}
            <span className="font-semibold text-zinc-900 dark:text-white">
              {departments.length}
            </span>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-12">
          {/* Add New Department - Prominent Card */}
          <div className="lg:col-span-5">
            <Card className="border-0 shadow-2xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl rounded-3xl overflow-hidden h-full">
              <CardHeader className="px-10 pt-10 pb-6">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
                    <Plus className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl">
                      Add New Department
                    </CardTitle>
                    <p className="text-zinc-600 dark:text-zinc-400 text-sm mt-1">
                      Create a new medical department or specialty
                    </p>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="px-10 pb-10">
                <CreateDepartmentForm />
              </CardContent>
            </Card>
          </div>

          {/* Departments List */}
          <div className="lg:col-span-7">
            <Card className="border-0 shadow-2xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl rounded-3xl overflow-hidden">
              <CardHeader className="px-10 pt-10 pb-6 border-b border-zinc-100 dark:border-zinc-800">
                <CardTitle className="flex items-center justify-between text-2xl">
                  All Departments
                  <span className="text-base font-normal text-zinc-500 dark:text-zinc-400">
                    ({departments.length})
                  </span>
                </CardTitle>
              </CardHeader>

              <CardContent className="p-10">
                {departments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <AlertCircle className="h-16 w-16 text-zinc-400 mb-6" />
                    <h3 className="text-2xl font-semibold text-zinc-900 dark:text-white">
                      No departments yet
                    </h3>
                    <p className="text-zinc-600 dark:text-zinc-400 mt-3 max-w-sm">
                      Start by adding your first department using the form on
                      the left.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {departments.map((dept) => (
                      <div
                        key={dept.id}
                        className="group flex items-center justify-between rounded-2xl border border-zinc-200 dark:border-zinc-800 p-7 hover:border-blue-200 dark:hover:border-blue-900 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-all duration-200"
                      >
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-xl text-zinc-900 dark:text-white tracking-tight">
                            {dept.name}
                          </h3>
                          {dept.description && (
                            <p className="text-zinc-600 dark:text-zinc-400 mt-2 text-[15px] line-clamp-2">
                              {dept.description}
                            </p>
                          )}
                        </div>

                        <div className="ml-6 flex items-center gap-4">
                          <span className="text-sm text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                            {dept.doctorCount} doctor{dept.doctorCount === 1 ? "" : "s"}
                          </span>
                          <DeleteDepartmentButton id={dept.id} name={dept.name} doctorCount={dept.doctorCount} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Helpful Note */}
        <div className="text-center text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
          Departments help organize doctors and services. Once created, you can
          assign doctors to specific departments.
        </div>
      </div>
    </div>
  );
}
