using System.Data;
using Dapper;

namespace Spiir.Api.Data;

// Dapper has no built-in DateOnly <-> SQL Server DATE mapping; without this, parameters bound to
// DateOnly properties (Transaction.BookingDate) fail to convert. Registered once at startup.
public class DateOnlyTypeHandler : SqlMapper.TypeHandler<DateOnly>
{
    public override void SetValue(IDbDataParameter parameter, DateOnly value)
    {
        parameter.DbType = DbType.Date;
        parameter.Value = value.ToDateTime(TimeOnly.MinValue);
    }

    public override DateOnly Parse(object value) => DateOnly.FromDateTime((DateTime)value);
}
